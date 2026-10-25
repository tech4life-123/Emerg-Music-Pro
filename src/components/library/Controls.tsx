"use client";

import { useActionState, useState } from "react";
import { HeartIcon } from "@/components/icons";
import { IDLE, type FormState } from "@/lib/forms";
import {
  addToPlaylistAction, createPlaylistAction, deletePlaylistAction, removeFromPlaylistAction, removeUnavailableAction,
  renamePlaylistAction, setFollowAction, setLikeAction,
} from "@/lib/library/actions";

const Msg = ({ s }: { s: FormState }) =>
  s.status === "error" ? <p className="form-error" role="alert">{s.message}</p> : s.status === "success" ? <p className="form-ok" role="status">{s.message}</p> : null;

export function LikeButton({ trackId, title, liked }: { trackId: string; title: string; liked: boolean }) {
  const [state, run, pending] = useActionState(setLikeAction, IDLE);
  return (
    <form action={run} className="inline-form">
      <input type="hidden" name="track_id" value={trackId} />
      <input type="hidden" name="like" value={liked ? "0" : "1"} />
      <button className="icon-btn" disabled={pending} aria-pressed={liked} aria-label={liked ? `Remove ${title} from liked songs` : `Add ${title} to liked songs`}>
        <HeartIcon filled={liked} />
      </button>
      {state.status === "error" ? <span className="form-error" role="alert">{state.message}</span> : null}
    </form>
  );
}

export function FollowButton({ artistId, name, following }: { artistId: string; name: string; following: boolean }) {
  const [state, run, pending] = useActionState(setFollowAction, IDLE);
  return (
    <form action={run} className="inline-form">
      <input type="hidden" name="artist_id" value={artistId} />
      <input type="hidden" name="follow" value={following ? "0" : "1"} />
      <button className={following ? "btn btn-ghost" : "btn"} disabled={pending} aria-pressed={following} aria-label={following ? `Unfollow ${name}` : `Follow ${name}`}>
        {following ? "Following" : "Follow"}
      </button>
      <Msg s={state.status === "error" ? state : IDLE} />
    </form>
  );
}

export function AddToPlaylist({ trackId, playlists }: { trackId: string; playlists: { id: string; name: string }[] }) {
  const [state, run, pending] = useActionState(addToPlaylistAction, IDLE);
  if (playlists.length === 0) return <p className="muted"><a href="/library">Create a playlist in your Library</a> to add this track.</p>;
  return (
    <form action={run} className="inline-form">
      <input type="hidden" name="track_id" value={trackId} />
      <label className="visually-hidden" htmlFor={`pl-${trackId}`}>Playlist</label>
      <select id={`pl-${trackId}`} name="playlist_id" defaultValue={playlists[0]!.id}>
        {playlists.map((p) => <option key={p.id} value={p.id}>{p.name}</option>)}
      </select>
      <button className="btn btn-ghost" disabled={pending}>Add to playlist</button>
      <Msg s={state} />
    </form>
  );
}

export function CreatePlaylistForm() {
  const [state, run, pending] = useActionState(createPlaylistAction, IDLE);
  return (
    <form action={run} className="inline-form">
      <label className="visually-hidden" htmlFor="new-playlist">Playlist name</label>
      <input id="new-playlist" name="name" maxLength={80} required placeholder="New playlist name" />
      <button className="btn" disabled={pending}>Create playlist</button>
      <Msg s={state} />
    </form>
  );
}

export function RenamePlaylistForm({ id, name }: { id: string; name: string }) {
  const [state, run, pending] = useActionState(renamePlaylistAction, IDLE);
  return (
    <form action={run} className="inline-form">
      <input type="hidden" name="playlist_id" value={id} />
      <label className="visually-hidden" htmlFor="rename-playlist">Playlist name</label>
      <input id="rename-playlist" name="name" maxLength={80} required defaultValue={name} />
      <button className="btn btn-ghost" disabled={pending}>Rename</button>
      <Msg s={state} />
    </form>
  );
}

export function DeletePlaylistForm({ id }: { id: string }) {
  const [state, run, pending] = useActionState(deletePlaylistAction, IDLE);
  const [armed, setArmed] = useState(false);
  return (
    <form action={run} className="inline-form">
      <input type="hidden" name="playlist_id" value={id} />
      {armed ? (
        <>
          <span>Delete this playlist? Its tracks stay in the catalog.</span>
          <button className="btn btn-danger btn-sm" disabled={pending}>Yes, delete playlist</button>
          <button type="button" className="btn btn-ghost btn-sm" onClick={() => setArmed(false)}>Cancel</button>
        </>
      ) : (
        <button type="button" className="btn btn-danger btn-sm" onClick={() => setArmed(true)}>Delete playlist</button>
      )}
      <Msg s={state} />
    </form>
  );
}

export function RemoveFromPlaylist({ playlistId, trackId, title }: { playlistId: string; trackId: string; title: string }) {
  const [state, run, pending] = useActionState(removeFromPlaylistAction, IDLE);
  return (
    <form action={run} className="inline-form">
      <input type="hidden" name="playlist_id" value={playlistId} />
      <input type="hidden" name="track_id" value={trackId} />
      <button className="btn btn-ghost btn-sm" disabled={pending} aria-label={`Remove ${title} from this playlist`}>Remove</button>
      <Msg s={state.status === "error" ? state : IDLE} />
    </form>
  );
}

export function RemoveUnavailable({ playlistId, count }: { playlistId: string; count: number }) {
  const [state, run, pending] = useActionState(removeUnavailableAction, IDLE);
  return (
    <form action={run} className="inline-form">
      <input type="hidden" name="playlist_id" value={playlistId} />
      <span className="muted">{count} {count === 1 ? "track is" : "tracks are"} no longer available.</span>
      <button className="btn btn-ghost btn-sm" disabled={pending}>Remove them</button>
      <Msg s={state} />
    </form>
  );
}
