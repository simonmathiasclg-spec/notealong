// The online version (private beta) runs when the Supabase settings are present at build time; without them
// the app talks to the local processing service exactly as before (./start.sh).
export const SUPABASE_URL = process.env.NEXT_PUBLIC_SUPABASE_URL ?? "";
export const SUPABASE_ANON_KEY = process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY ?? "";
export const CLOUD = !!(SUPABASE_URL && SUPABASE_ANON_KEY);

export const UPLOADS_PER_DAY = 10;      // beta testers (emails on the allowlist) and the owner
export const FREE_SONGS = 1;             // everyone else: one song of their own, for the life of the account

/** The built-in song "Try it: no sign-in needed" opens in the player. */
export const TRY_SONG_ID = "amazing-grace";
export const MAX_UPLOAD_MB = 50;
export const MAX_MINUTES = 12;

/** A public file of the built-in catalog (public domain and Creative Commons songs). */
export const catalogFile = (path: string) => `${SUPABASE_URL}/storage/v1/object/public/catalog/${path}`;

export const AUDIO_EXT = ["mp3", "wav", "m4a", "aac", "flac", "ogg", "oga", "opus", "aiff", "aif", "wma", "m4b", "caf", "amr"];
export const VIDEO_EXT = ["mp4", "m4v", "mov", "webm", "mkv", "avi", "mpg", "mpeg", "3gp", "ts"];
export const PROTECTED_EXT = ["m4p", "aax", "aa"];
