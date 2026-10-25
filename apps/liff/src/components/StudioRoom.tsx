import { useState } from 'preact/hooks';
import { OTHER_STUDIO, findStudio, roomInfo, type StudioDef } from '@pb/shared';

const OTHER_ROOM = '__other__';

/** スタジオを一覧から選ぶ。一覧にないときは「その他」で手入力 */
export function StudioSelect({ studios, value, onChange }: { studios: StudioDef[]; value: string; onChange: (v: string) => void }) {
  const inList = studios.some((s) => s.name === value);
  const [other, setOther] = useState(!inList && value !== '');
  const selected = inList ? value : other ? OTHER_STUDIO : '';
  return (
    <>
      <select
        value={selected}
        onChange={(e) => {
          const v = e.currentTarget.value;
          setOther(v === OTHER_STUDIO);
          onChange(v === OTHER_STUDIO || v === '' ? '' : v);
        }}
      >
        <option value="">選択してください</option>
        {studios.map((s) => (
          <option value={s.name}>{s.name}</option>
        ))}
        <option value={OTHER_STUDIO}>{OTHER_STUDIO}</option>
      </select>
      {selected === OTHER_STUDIO && (
        <input type="text" style={{ marginTop: 6 }} placeholder="スタジオ名" value={value} onInput={(e) => onChange(e.currentTarget.value)} />
      )}
    </>
  );
}

/** 部屋を選ぶ。部屋の一覧があるスタジオはプルダウン、一覧にない部屋は「その他」で手入力 */
export function RoomSelect({ studios, studio, value, onChange }: { studios: StudioDef[]; studio: string; value: string; onChange: (v: string) => void }) {
  const def = findStudio(studios, studio);
  const rooms = def?.rooms ?? [];
  const inList = rooms.some((r) => r.name === value);
  const [other, setOther] = useState(!inList && value !== '');
  if (rooms.length === 0) {
    return <input type="text" placeholder="例：A" value={value} onInput={(e) => onChange(e.currentTarget.value)} />;
  }
  const selected = inList ? value : other ? OTHER_ROOM : '';
  return (
    <>
      <select
        value={selected}
        onChange={(e) => {
          const v = e.currentTarget.value;
          setOther(v === OTHER_ROOM);
          onChange(v === OTHER_ROOM ? '' : v);
        }}
      >
        <option value="">選択してください</option>
        {rooms.map((r) => (
          <option value={r.name}>{r.name}</option>
        ))}
        <option value={OTHER_ROOM}>その他（手入力）</option>
      </select>
      {selected === OTHER_ROOM && (
        <input type="text" style={{ marginTop: 6 }} placeholder="部屋名" value={value} onInput={(e) => onChange(e.currentTarget.value)} />
      )}
    </>
  );
}

/** 部屋の広さなどの補足（一覧にあるときだけ） */
export function RoomInfo({ studios, studio, room, style }: { studios: StudioDef[]; studio: string; room: string; style?: Record<string, string | number> }) {
  const info = roomInfo(studios, studio, room);
  return info ? (
    <div class="room-info" style={style}>
      {info}
    </div>
  ) : null;
}
