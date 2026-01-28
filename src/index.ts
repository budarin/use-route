import type {
    Navigation,
    KnownRoutes,
    RouterState,
    NavigateOptions,
    UseRouterReturn,
    NavigationNavigateOptions,
} from './types';

import { getRouterConfig } from './types';
import { useSyncExternalStore, useCallback, useMemo } from 'react';

// Утилита для проверки браузерного окружения
const isBrowser = typeof window !== 'undefined';

// Валидация URL: разрешаем только http://, https:// и относительные пути
function isValidUrl(url: string): boolean {
    if (!url || typeof url !== 'string') return false;

    // Относительные пути всегда валидны
    if (url.startsWith('/') || !url.includes(':')) return true;

    // Абсолютные URL должны начинаться с http:// или https://
    try {
        const parsed = new URL(url);
        return parsed.protocol === 'http:' || parsed.protocol === 'https:';
    } catch {
        return false;
    }
}

// Создание RegExp из паттерна роута
function createRouteRegExp(pattern: string): RegExp {
    return new RegExp('^' + pattern.replace(/:(\w+)/g, '(?<$1>[^/]+)') + '$');
}

// Проверка соответствия паттерна pathname
function testPattern(compiled: URLPattern | RegExp, pathname: string): boolean {
    if (compiled instanceof URLPattern) {
        return compiled.test({ pathname });
    }
    return (compiled as RegExp).test(pathname);
}

// Подписка на изменения навигации (navigate + currententrychange)[web:225][web:220]
function subscribeNavigation(navigation: Navigation) {
    return (callback: () => void) => {
        const update = () => callback();
        navigation.addEventListener('navigate', update);
        navigation.addEventListener('currententrychange', update);
        return () => {
            navigation.removeEventListener('navigate', update);
            navigation.removeEventListener('currententrychange', update);
        };
    };
}

// Кэш для URLPattern / RegExp, чтобы не пересоздавать каждый рендер[web:140][web:221]
const PATTERN_CACHE = new Map<string, URLPattern | RegExp>();

function getCompiledPattern(pattern: string): URLPattern | RegExp {
    if (!PATTERN_CACHE.has(pattern)) {
        if (typeof URLPattern !== 'undefined') {
            try {
                PATTERN_CACHE.set(pattern, new URLPattern({ pathname: pattern }));
            } catch {
                PATTERN_CACHE.set(pattern, createRouteRegExp(pattern));
            }
        } else {
            PATTERN_CACHE.set(pattern, createRouteRegExp(pattern));
        }
    }
    return PATTERN_CACHE.get(pattern)!;
}

// Общий LRU-кэш URL → разобранный URL (один на модуль, лимит из configureRouter)[web:133]
const URL_CACHE = new Map<string, URL>();

function getCachedParsedUrl(urlStr: string): URL {
    const cache = URL_CACHE;
    const existing = cache.get(urlStr);
    if (existing !== undefined) {
        cache.delete(urlStr);
        cache.set(urlStr, existing);
        return existing;
    }
    const base = isBrowser ? window.location.origin : 'http://localhost';
    try {
        const parsed = new URL(urlStr, base);
        const limit = getRouterConfig().urlCacheLimit;
        if (cache.has(urlStr)) {
            cache.delete(urlStr);
        } else if (cache.size >= limit) {
            const firstKey = cache.keys().next().value;
            if (firstKey !== undefined) cache.delete(firstKey);
        }
        cache.set(urlStr, parsed);
        return parsed;
    } catch (error) {
        console.warn('[useRouter] Invalid URL:', urlStr, error);
        try {
            return new URL('/', base);
        } catch {
            return new URL('http://localhost/');
        }
    }
}

// Парсинг params по паттерну: '/users/:id' + '/users/123' → { id: '123' }[web:140][web:125]
function parseParams(pathname: string, routePattern?: string): Record<string, string> {
    if (!routePattern) return {};

    const compiled = getCompiledPattern(routePattern);

    // Ветка URLPattern (нативная)[web:140][web:221]
    if (compiled instanceof URLPattern) {
        const match = compiled.exec({ pathname });
        return (match?.pathname.groups ?? {}) as Record<string, string>;
    }

    // Ветка RegExp с именованными группами
    const re = compiled as RegExp;
    const m = pathname.match(re);

    if (!m || !m.groups) return {};

    return m.groups as Record<string, string>;
}

// Экспортируем configureRouter для глобальной настройки
export { configureRouter } from './types';

export function useRouter(knownRoutes?: KnownRoutes): UseRouterReturn {
    const navigation: Navigation | undefined =
        typeof window !== 'undefined' && 'navigation' in window
            ? (window.navigation as Navigation)
            : undefined;

    // 1. useSyncExternalStore — только ключ текущей записи и флаги canGoBack/Forward[web:225][web:219]
    // Мемоизируем getSnapshot для стабильности
    const getSnapshot = useMemo(() => {
        let cached: {
            currentKey: string;
            canGoBackFlag: boolean;
            canGoForwardFlag: boolean;
            entriesKeys: string[];
        } | null = null;

        return () => {
            const currentKey = navigation?.currentEntry?.key ?? '';
            const canGoBackFlag = !!navigation?.canGoBack;
            const canGoForwardFlag = !!navigation?.canGoForward;
            const entriesKeys = navigation?.entries.map((e) => e.key) ?? [];

            // Возвращаем кэшированный объект, если значения не изменились
            if (
                cached &&
                cached.currentKey === currentKey &&
                cached.canGoBackFlag === canGoBackFlag &&
                cached.canGoForwardFlag === canGoForwardFlag &&
                cached.entriesKeys.length === entriesKeys.length &&
                cached.entriesKeys.every((key, i) => key === entriesKeys[i])
            ) {
                return cached;
            }

            cached = {
                currentKey,
                canGoBackFlag,
                canGoForwardFlag,
                entriesKeys,
            };
            return cached;
        };
    }, [navigation]);

    const rawState = useSyncExternalStore(
        navigation ? subscribeNavigation(navigation) : () => () => {},
        getSnapshot,
        () => ({
            currentKey: '',
            canGoBackFlag: false,
            canGoForwardFlag: false,
            entriesKeys: [] as string[],
        })
    );

    // Map для O(1) поиска historyIndex
    const keyToIndexMap = useMemo(() => {
        const map = new Map<string, number>();
        rawState.entriesKeys.forEach((key, index) => {
            map.set(key, index);
        });
        return map;
    }, [rawState.entriesKeys]);

    // 2. Производное состояние роутера (мемоизировано)
    const routerState: RouterState & {
        _entriesKeys: string[];
    } = useMemo(() => {
        const currentEntry = navigation?.currentEntry ?? null;
        const urlStr = currentEntry?.url ?? (isBrowser ? window.location.href : '/');
        const parsed = getCachedParsedUrl(urlStr);
        const pathname = parsed.pathname;

        // Поиск подходящего паттерна среди knownRoutes (если передан)
        let matchedPattern: string | undefined;
        if (knownRoutes) {
            for (const pattern of Object.values(knownRoutes)) {
                const compiled = getCompiledPattern(pattern);
                if (testPattern(compiled, pathname)) {
                    matchedPattern = pattern;
                    break;
                }
            }
        }

        const params = matchedPattern ? parseParams(pathname, matchedPattern) : {};
        // O(1) поиск вместо O(n) indexOf
        const historyIndex = keyToIndexMap.get(rawState.currentKey) ?? -1;

        return {
            location: urlStr,
            pathname,
            searchParams: parsed.searchParams,
            params,
            historyIndex,
            _entriesKeys: rawState.entriesKeys,
        };
    }, [navigation, rawState.currentKey, rawState.entriesKeys, knownRoutes, keyToIndexMap]);

    // 3. Навигационные операции[web:217][web:219]
    const navigate = useCallback(
        async (to: string | URL, options: NavigateOptions = {}): Promise<void> => {
            const targetUrl = typeof to === 'string' ? to : to.toString();

            // Валидация URL
            if (!isValidUrl(targetUrl)) {
                console.warn('[useRouter] Invalid URL rejected:', targetUrl);
                return;
            }

            if (!navigation) {
                // Fallback на History API
                if (isBrowser) {
                    try {
                        if (options.replace) {
                            window.history.replaceState(options.state, '', targetUrl);
                        } else {
                            window.history.pushState(options.state, '', targetUrl);
                        }
                    } catch (error) {
                        console.error('[useRouter] History API error:', error);
                    }
                }
                return;
            }

            const navOptions: NavigationNavigateOptions = { state: options.state };
            if (options.history === 'replace' || options.replace) {
                navOptions.history = 'replace';
            } else if (options.history === 'push') {
                navOptions.history = 'push';
            } else {
                navOptions.history = 'auto';
            }

            try {
                await navigation.navigate(targetUrl, navOptions);
            } catch (error) {
                console.error('[useRouter] Navigation error:', error);
                // Пробуем fallback на History API
                if (isBrowser) {
                    try {
                        if (options.replace) {
                            window.history.replaceState(options.state, '', targetUrl);
                        } else {
                            window.history.pushState(options.state, '', targetUrl);
                        }
                    } catch (fallbackError) {
                        console.error('[useRouter] History API fallback error:', fallbackError);
                    }
                }
            }
        },
        [navigation]
    );

    const back = useCallback(() => {
        try {
            if (navigation) {
                navigation.back();
            } else if (isBrowser) {
                window.history.back();
            }
        } catch (error) {
            console.error('[useRouter] Back navigation error:', error);
        }
    }, [navigation]);

    const forward = useCallback(() => {
        try {
            if (navigation) {
                navigation.forward();
            } else if (isBrowser) {
                window.history.forward();
            }
        } catch (error) {
            console.error('[useRouter] Forward navigation error:', error);
        }
    }, [navigation]);

    const canGoBack = useCallback(
        (steps: number = 1): boolean => {
            // Валидация входных данных
            if (!Number.isFinite(steps) || steps < 0 || steps > Number.MAX_SAFE_INTEGER) {
                return false;
            }

            if (!navigation || routerState._entriesKeys.length === 0) {
                // Для History API точной информации нет — считаем, что 1 шаг ок,
                // а больше уже зависит от history.length (грубая эвристика).
                if (!isBrowser) return false;
                return steps <= window.history.length - 1;
            }
            const idx = routerState.historyIndex;
            if (idx === -1) return false;
            return idx - steps >= 0;
        },
        [navigation, routerState._entriesKeys.length, routerState.historyIndex]
    );

    const canGoForward = useCallback(
        (steps: number = 1): boolean => {
            // Валидация входных данных
            if (!Number.isFinite(steps) || steps < 0 || steps > Number.MAX_SAFE_INTEGER) {
                return false;
            }

            if (!navigation || routerState._entriesKeys.length === 0) {
                if (!isBrowser) return false;
                // Для обычного History API вперёд проверить нельзя корректно.
                return false;
            }
            const idx = routerState.historyIndex;
            if (idx === -1) return false;
            return idx + steps < routerState._entriesKeys.length;
        },
        [navigation, routerState._entriesKeys.length, routerState.historyIndex]
    );

    const go = useCallback(
        (delta: number): void => {
            // Валидация входных данных
            if (delta === Infinity || delta === -Infinity) {
                console.warn('[useRouter] Delta value too large:', delta);
                return;
            }
            if (!Number.isFinite(delta) || delta === 0) return;
            if (delta > Number.MAX_SAFE_INTEGER || delta < -Number.MAX_SAFE_INTEGER) {
                console.warn('[useRouter] Delta value too large:', delta);
                return;
            }

            try {
                if (navigation && routerState._entriesKeys.length > 0) {
                    const idx = routerState.historyIndex;
                    if (idx === -1) return;
                    const targetIdx = idx + delta;
                    if (targetIdx < 0 || targetIdx >= routerState._entriesKeys.length) {
                        return;
                    }
                    const targetKey = routerState._entriesKeys[targetIdx];
                    if (targetKey === undefined) return;
                    navigation.traverseTo(targetKey);
                } else if (isBrowser) {
                    window.history.go(delta);
                }
            } catch (error) {
                console.error('[useRouter] Go navigation error:', error);
            }
        },
        [navigation, routerState._entriesKeys, routerState.historyIndex]
    );

    const replace = useCallback(
        (to: string | URL, state?: unknown) => navigate(to, { replace: true, state }),
        [navigate]
    );

    return {
        navigate,
        back,
        forward,
        go,
        replace,
        canGoBack,
        canGoForward,
        location: routerState.location,
        pathname: routerState.pathname,
        searchParams: routerState.searchParams,
        params: routerState.params,
        historyIndex: routerState.historyIndex,
    };
}
