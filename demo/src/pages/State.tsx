import { useRoute } from '@budarin/use-route';
import { Link } from '../components/Link';
import { useState, useEffect } from 'react';

export function State() {
    const { pathname, state, navigate, updateState } = useRoute();
    const [draftInput, setDraftInput] = useState('');

    // Восстанавливаем черновик из state при монтировании (например, после «Назад»)
    useEffect(() => {
        if (state != null && typeof state === 'object' && 'draft' in state) {
            const value = (state as { draft?: string }).draft;
            if (typeof value === 'string') setDraftInput(value);
        }
    }, [state]);

    const handleSaveDraft = () => {
        updateState({
            ...(state != null && typeof state === 'object' ? (state as object) : {}),
            draft: draftInput,
        });
    };

    const isDetail = pathname === '/state/detail';

    if (isDetail) {
        return (
            <div className="demo-content">
                <h1>State: страница «Детали»</h1>
                <p className="demo-lead">
                    Вы перешли сюда с установленным <strong>state</strong> (через{' '}
                    <code>
                        navigate(&apos;/state/detail&apos;, &#123; state: &#123; ... &#125; &#125;)
                    </code>
                    ). Ниже — то, что лежит в записи истории для этой страницы.
                </p>
                <p>
                    <strong>state</strong> текущей записи:{' '}
                    <code
                        style={{ background: '#f0f0f0', padding: '0.2em 0.4em', borderRadius: 4 }}
                    >
                        {state != null ? JSON.stringify(state) : '—'}
                    </code>
                </p>
                <p>
                    <Link to="/state">← Вернуться к примеру State</Link>
                </p>
            </div>
        );
    }

    return (
        <div className="demo-content">
            <h1>State: установка, чтение и обновление</h1>
            <p className="demo-lead">
                <strong>state</strong> — произвольные данные записи истории. Его можно задать при
                переходе (<code>navigate(to, &#123; state &#125;)</code>), прочитать в хуке (
                <code>state</code>) и обновить на текущей странице без навигации (
                <code>updateState(state)</code>). Ниже: переход с state, отображение текущего state
                и черновик формы через updateState.
            </p>
            <p>
                Текущий путь: <code>{pathname}</code>
            </p>
            <p>
                <strong>state</strong> текущей записи:{' '}
                <code style={{ background: '#f0f0f0', padding: '0.2em 0.4em', borderRadius: 4 }}>
                    {state != null ? JSON.stringify(state) : '—'}
                </code>
            </p>

            <h2>Установка state при навигации</h2>
            <p>
                При переходе на «Детали» передаём в state объект — на той странице он будет доступен
                как <code>state</code>.
            </p>
            <div className="demo-buttons">
                <button
                    type="button"
                    onClick={() =>
                        navigate('/state/detail', {
                            state: { from: 'state-page', timestamp: Date.now() },
                        })
                    }
                >
                    Перейти на «Детали» с state
                </button>
            </div>

            <h2>Обновление state на текущей странице (updateState)</h2>
            <p>
                Черновик формы: введите текст и нажмите «Сохранить черновик». State текущей записи
                обновится без навигации. Уйдите на другую страницу и нажмите «Назад» — черновик
                восстановится из state.
            </p>
            <div style={{ display: 'flex', flexWrap: 'wrap', alignItems: 'center', gap: '0.5rem' }}>
                <input
                    type="text"
                    value={draftInput}
                    onChange={(e) => setDraftInput(e.target.value)}
                    placeholder="Текст черновика"
                    style={{
                        padding: '0.4em 0.6em',
                        border: '1px solid #ccc',
                        borderRadius: 4,
                        minWidth: 200,
                    }}
                />
                <button type="button" onClick={handleSaveDraft}>
                    Сохранить черновик
                </button>
            </div>

            <p>
                <Link to="/">На главную</Link>
            </p>
        </div>
    );
}
