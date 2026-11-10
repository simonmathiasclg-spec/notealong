import type { Metadata } from "next";
import { LegalPage } from "@/components/cloud/LegalPage";

export const metadata: Metadata = { title: "Privacy · NoteAlong" };

export default function PrivacyPage() {
  return (
    <LegalPage title="Privacy" updated="10 November 2026">
      <p>NoteAlong keeps as little about you as it can, and what you add is visible only to you.</p>

      <h2>What we keep</h2>
      <ul>
        <li>Your email address, to sign you in.</li>
        <li>The songs you add and what is made from them: the backing track, the voice on its own, the notes, the words, and the cover picture.</li>
        <li>What you change and choose: note fixes, player settings, favourites, how often you play a song, and setlists.</li>
        <li>A record of each processing job: when it ran, how long it took, and any error, so we can fix problems and know what the service costs.</li>
        <li>If you join the waitlist: your email and the note you leave.</li>
      </ul>

      <h2>What we don&apos;t do</h2>
      <ul>
        <li>No advertising, no selling or renting your data, no tracking across other sites.</li>
        <li>The only cookie is the one that keeps you signed in.</li>
        <li>Your songs are never shown to other users, never reused for another account, and never used to train models.</li>
      </ul>

      <h2>Who can see your songs</h2>
      <p>Only you. Each user&apos;s files sit in their own private folder, and the database lets an account read only its own rows. The owner&apos;s overview shows how many songs and jobs each account has and any error messages, never song titles or files.</p>

      <h2>Services we use</h2>
      <ul>
        <li>Supabase: accounts, sign-in emails, the database and file storage (United States).</li>
        <li>Modal: the computers that separate the voice and find the notes. Your file is copied there for the job and deleted when it ends.</li>
        <li>Vercel: hosts the website.</li>
      </ul>

      <h2>How long we keep it</h2>
      <ul>
        <li>Your songs stay until you delete them. Deleting a song removes its files and its data at once.</li>
        <li>Deleting your account (on the account page) removes your account, every song and file, your edits, favourites, setlists and job records. Our providers&apos; backups can hold copies for a short time after that. [The exact backup period is to be confirmed for the plan in use.]</li>
        <li>Monthly totals of processing time are kept without any link to a person.</li>
      </ul>

      <h2>Your rights</h2>
      <p>You can see and change your data in the app, and delete all of it yourself. For a copy of your data or any other request, write to [owner&apos;s contact email]. NoteAlong is not meant for children under 13. [Age limits and the legal basis for processing in each country are to be set by a lawyer.]</p>
    </LegalPage>
  );
}
