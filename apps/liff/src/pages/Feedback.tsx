import { useState } from 'preact/hooks';
import { api } from '../api';
import { Icon, TopBar, useApp, useRunner } from '../ui';

/** 要望を送るだけの画面（届いた要望はスプレッドシートの「要望」シートで見る） */
export function FeedbackPage() {
  const { me } = useApp();
  const [text, setText] = useState('');
  const [run, busy] = useRunner();

  const post = async (e: Event) => {
    e.preventDefault();
    if (await run(() => api('postFeedback', { text }), '要望を送りました。ありがとうございます！')) setText('');
  };

  return (
    <>
      <TopBar title="要望" />
      <form class="feedback-form" onSubmit={post}>
        <textarea rows={6} maxLength={1000} value={text} aria-label="要望" placeholder="こうなったら便利、ここが使いにくい、など" onInput={(e) => setText(e.currentTarget.value)} />
        <button class="btn primary block" disabled={busy || !text.trim()}>
          <Icon name="send" size={18} />
          送る
        </button>
        <p class="muted">{me.member.name} として管理者だけに届きます</p>
      </form>
    </>
  );
}
