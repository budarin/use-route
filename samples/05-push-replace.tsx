/**
 * push vs replace: navigate(..., { history: 'push' | 'replace' })
 * push — новая запись в истории, replace — замена текущей.
 */
import { useRouter } from '@budarin/react-router';

export function PushReplaceExample() {
    const { navigate, replace, pathname } = useRouter();

    return (
        <div>
            <p>Текущий путь: {pathname}</p>
            <button type="button" onClick={() => navigate('/step-push', { history: 'push' })}>
                Перейти (push) — в истории появится запись
            </button>
            <button type="button" onClick={() => navigate('/step-replace', { history: 'replace' })}>
                Перейти (replace через navigate)
            </button>
            <button type="button" onClick={() => replace('/step-replace-method')}>
                Перейти через replace() — то же, что history: 'replace'
            </button>
        </div>
    );
}
