import { useState } from 'react';
import { api } from '../api';

export type TrainingKind =
  | 'brief-edit'
  | 'keyword-feedback'
  | 'verdict-correction'
  | 'recommendation-priority'
  | 'agent-output';

export interface TrainingSubject {
  providerId?: string;
  keywordId?: string;
  category?: string;
  city?: string;
  agentId?: string;
}

interface Props {
  kind: TrainingKind;
  subject: TrainingSubject;
  /** Что pipeline выдал автоматически — отображается read-only сверху */
  originalData?: any;
  /** Если поддерживается inline-редактирование — компонент вернёт edited через onSubmit */
  editedData?: any;
  /** После успешного сохранения — для refresh внешних списков */
  onSaved?: () => void;
  /** Заголовок секции */
  title?: string;
  /** Подсказка/placeholder для textarea */
  placeholder?: string;
}

const DEFAULT_TITLES: Record<TrainingKind, string> = {
  'brief-edit': '🤖 Обучение Director\'а — feedback на brief',
  'keyword-feedback': '🤖 Feedback на keyword',
  'verdict-correction': '🤖 Поправить audit verdict',
  'recommendation-priority': '🤖 Приоритет рекомендации',
  'agent-output': '🤖 Feedback на ответ агента',
};

const DEFAULT_PLACEHOLDERS: Record<TrainingKind, string> = {
  'brief-edit': 'Этот brief хорош/плох потому что... Что бы ты добавил/убрал?',
  'keyword-feedback': 'Этот ключ релевантен/нерелевантен потому что...',
  'verdict-correction': 'Verdict неправильный потому что...',
  'recommendation-priority': 'Эта рекомендация важнее/менее важна потому что...',
  'agent-output': 'Ответ агента хорош/плох потому что...',
};

export function TrainingFeedbackPanel({
  kind,
  subject,
  originalData,
  editedData,
  onSaved,
  title,
  placeholder,
}: Props) {
  const [comment, setComment] = useState('');
  const [rating, setRating] = useState(0);
  const [saving, setSaving] = useState(false);
  const [savedFlash, setSavedFlash] = useState(false);

  async function save() {
    if (!comment.trim() || saving) return;
    setSaving(true);
    try {
      await api.post('/seo/training/feedback', {
        kind,
        providerId: subject.providerId,
        keywordId: subject.keywordId,
        category: subject.category,
        city: subject.city,
        originalData: originalData ?? null,
        editedData: editedData ?? originalData ?? null,
        userComment: comment.trim(),
        rating,
      });
      setComment('');
      setRating(0);
      setSavedFlash(true);
      setTimeout(() => setSavedFlash(false), 2500);
      onSaved?.();
    } catch (e: any) {
      alert(`Ошибка: ${e.response?.data?.error || e.message}`);
    } finally {
      setSaving(false);
    }
  }

  return (
    <div className="rounded-lg border border-blue-500/30 bg-blue-500/5 p-3">
      <div className="text-xs uppercase text-blue-300 mb-2 flex items-center justify-between">
        <span>{title ?? DEFAULT_TITLES[kind]}</span>
        {savedFlash && <span className="text-emerald-300 normal-case">✓ сохранено — Director учится</span>}
      </div>
      <textarea
        value={comment}
        onChange={e => setComment(e.target.value)}
        placeholder={placeholder ?? DEFAULT_PLACEHOLDERS[kind]}
        rows={2}
        className="w-full px-3 py-2 rounded bg-slate-900/60 border border-white/10 text-sm"
      />
      <div className="flex items-center gap-2 mt-2">
        <span className="text-xs text-slate-400">Оценка:</span>
        {[-2, -1, 0, 1, 2].map(r => (
          <button
            key={r}
            onClick={() => setRating(r)}
            className={`w-8 h-8 rounded text-sm transition ${
              rating === r ? 'bg-blue-600 text-white' : 'bg-slate-700 text-slate-300 hover:bg-slate-600'
            }`}>
            {r > 0 ? `+${r}` : r}
          </button>
        ))}
        <button
          onClick={save}
          disabled={!comment.trim() || saving}
          className="ml-auto px-3 py-1.5 rounded bg-blue-600 hover:bg-blue-700 disabled:opacity-50 text-xs">
          {saving ? 'Сохраняю...' : 'Сохранить → Director узнает'}
        </button>
      </div>
    </div>
  );
}
