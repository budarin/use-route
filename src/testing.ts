import type { Navigation } from './native-api-types';

interface TestNavigationSetupOptions {
    /** Начальный URL для тестовой среды (по умолчанию http://localhost/). */
    initialUrl?: string;
}

/**
 * Создаёт минимальный in-memory Navigation API для тестов.
 * Достаточно того, что требуется хуку useRoute: currentEntry, entries, state и события.
 */
function createTestNavigation(initialUrl: string): Navigation {
    const url = new URL(initialUrl);

    const entry = {
        key: 'test-key-0',
        url: url.toString(),
        getState: () => undefined as unknown,
    };

    const entries = [entry];
    const listeners = new Map<string, Set<(event: Event) => void>>();

    const addEventListener = (type: string, listener: (event: Event) => void) => {
        let set = listeners.get(type);
        if (!set) {
            set = new Set();
            listeners.set(type, set);
        }
        set.add(listener);
    };

    const removeEventListener = (type: string, listener: (event: Event) => void) => {
        const set = listeners.get(type);
        if (!set) return;
        set.delete(listener);
        if (set.size === 0) {
            listeners.delete(type);
        }
    };

    const dispatchEvent = (type: string, event: Event) => {
        const set = listeners.get(type);
        if (!set) return;
        for (const listener of set) {
            listener(event);
        }
    };

    const navigation: Navigation = {
        currentEntry: entry as Navigation['currentEntry'],
        entries: () => entries as unknown as ReturnType<Navigation['entries']>,
        canGoBack: false,
        canGoForward: false,
        navigate: async () => {
            // Для большинства тестов достаточно успешного завершения без побочных эффектов.
            return {
                committed: Promise.resolve(),
                finished: Promise.resolve(),
            } as Awaited<ReturnType<Navigation['navigate']>>;
        },
        back: () => {
            /* no-op в тестах */
        },
        forward: () => {
            /* no-op в тестах */
        },
        traverseTo: () => ({
            committed: Promise.resolve(),
            finished: Promise.resolve(),
        }),
        updateCurrentEntry: (opts?: { state?: unknown }) => {
            if (opts && 'state' in opts) {
                const state = opts.state;
                (entry as { getState: () => unknown }).getState = () => state;
            }
        },
        addEventListener,
        removeEventListener,
        dispatchEvent: (event: Event) => {
            dispatchEvent(event.type, event);
            return true;
        },
    };

    // Возможность вручную триггерить события в специфичных тестах
    (navigation as unknown as { __dispatchTestEvent: typeof dispatchEvent }).__dispatchTestEvent =
        dispatchEvent;

    return navigation;
}

/**
 * Настраивает тестовую среду для useRoute:
 * - переопределяет window.location на заданный URL;
 * - устанавливает in-memory Navigation API в window.navigation.
 *
 * Предназначен для использования в jsdom-подобных окружениях.
 *
 * Возвращает функцию, которая восстанавливает исходное состояние window.
 */
export function setupTestNavigation(options: TestNavigationSetupOptions = {}): () => void {
    const { initialUrl = 'http://localhost/' } = options;

    if (typeof window === 'undefined') {
        throw new Error(
            '[useRoute/testing] setupTestNavigation requires a browser-like environment (window is undefined)'
        );
    }

    const testWindow = window as typeof window & {
        navigation?: Navigation;
    };

    const originalLocation = window.location;
    const originalNavigation = testWindow.navigation;

    const url = new URL(initialUrl);

    // Обновляем location целиком, чтобы pathname/search/hash соответствовали initialUrl.
    Object.defineProperty(testWindow, 'location', {
        configurable: true,
        writable: true,
        value: {
            ...originalLocation,
            href: url.toString(),
            origin: url.origin,
            pathname: url.pathname,
            search: url.search,
            hash: url.hash,
        } as Location,
    });

    testWindow.navigation = createTestNavigation(initialUrl);

    return () => {
        // Восстанавливаем исходные значения
        Object.defineProperty(testWindow, 'location', {
            configurable: true,
            writable: true,
            value: originalLocation,
        });
        if (originalNavigation === undefined) {
            delete testWindow.navigation;
        } else {
            testWindow.navigation = originalNavigation;
        }
    };
}
