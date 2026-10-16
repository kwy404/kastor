'use client';

import { useActionState } from 'react';
import { createPost, type FormState } from './actions';

const initial: FormState = { error: null };

export function PostForm({ authors }: { authors: Array<{ id: number; name: string }> }) {
  const [state, action, pending] = useActionState(createPost, initial);
  return (
    <form action={action} className="card card-bordered">
      <div className="card-body form-grid">
        <h2 className="card-title">New post</h2>
        <label>
          Title
          <input name="title" className="input" required maxLength={200} placeholder="What is it about?" />
        </label>
        <label>
          Text
          <textarea name="body" className="textarea" rows={3} placeholder="Optional" />
        </label>
        <label>
          Author
          <select name="authorId" className="select">
            {authors.map((a) => (
              <option key={a.id} value={a.id}>
                {a.name}
              </option>
            ))}
          </select>
        </label>
        {state.error ? (
          <p className="text-sm text-danger" role="alert">
            {state.error}
          </p>
        ) : null}
        <div>
          <button type="submit" className="btn btn-primary" disabled={pending}>
            {pending ? 'Saving' : 'Add post'}
          </button>
        </div>
      </div>
    </form>
  );
}
