'use server';

import { revalidatePath } from 'next/cache';
import { db } from '@/db';
import { addPost, deletePost } from '@/db/posts';

export interface FormState {
  error: string | null;
}

export async function createPost(_previous: FormState, form: FormData): Promise<FormState> {
  try {
    await addPost(db, {
      title: String(form.get('title') ?? ''),
      body: String(form.get('body') ?? ''),
      authorId: Number(form.get('authorId')),
    });
  } catch (error) {
    return { error: error instanceof Error ? error.message : 'The post could not be saved.' };
  }
  revalidatePath('/');
  return { error: null };
}

export async function removePost(id: number): Promise<void> {
  await deletePost(db, id);
  revalidatePath('/');
}
