import { db } from '@/db';
import { latestPosts, listAuthors } from '@/db/posts';
import { removePost } from './actions';
import { PostForm } from './post-form';

// Read the database on every request.
export const dynamic = 'force-dynamic';

export default async function Home() {
  const [posts, authors] = await Promise.all([latestPosts(db), listAuthors(db)]);
  return (
    <main className="page">
      <header>
        <h1>Posts</h1>
        <p className="text-muted-foreground">
          A Next.js page that reads SQLite through kastor. Each post comes with its author in one query. Run <code>npm run studio</code> to
          browse the tables and the SQL.
        </p>
      </header>
      <PostForm authors={authors.map((a) => ({ id: a.id, name: a.name }))} />
      {posts.length === 0 ? (
        <div className="empty-state empty-state-bordered">
          <h2 className="empty-state-title">No posts yet</h2>
          <p className="empty-state-description">Write the first one with the form above.</p>
        </div>
      ) : (
        <ul className="posts">
          {posts.map((post) => (
            <li key={post.id} className="card card-bordered">
              <div className="card-body">
                <div className="post-head">
                  <h2>{post.title}</h2>
                  <form action={removePost.bind(null, post.id)}>
                    <button type="submit" className="btn btn-ghost btn-sm" aria-label={`Delete ${post.title}`}>
                      Delete
                    </button>
                  </form>
                </div>
                {post.body ? <p>{post.body}</p> : null}
                <p className="text-sm text-muted-foreground">
                  by {post.author.name}, {post.createdAt.toLocaleDateString('en', { dateStyle: 'medium' })}
                </p>
              </div>
            </li>
          ))}
        </ul>
      )}
    </main>
  );
}
