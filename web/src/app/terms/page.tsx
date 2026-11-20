import type { Metadata } from "next";
import { LegalPage } from "@/components/cloud/LegalPage";

export const metadata: Metadata = { title: "Terms · NoteAlong" };

export default function TermsPage() {
  return (
    <LegalPage title="Terms of use" updated="19 November 2026">
      <p>These terms cover your use of NoteAlong. By using it, and by creating an account, you agree to them.</p>

      <h2>What is free</h2>
      <ul>
        <li>Every built-in song is free to play, with or without an account.</li>
        <li>Each person can convert one song of their own for free: NoteAlong separates the voice, finds the notes and lines them up with the words. You keep that song and can use it fully (key changes, note fixes, trims, setlists, favourites). Deleting it does not give you another free song, and neither does a new account for the same person or email.</li>
        <li>Paid plans for converting more songs will come later. Nothing is charged today, and you&apos;ll be asked before anything ever is.</li>
        <li>Invited testers can add up to 10 new songs a day while NoteAlong is being tested.</li>
        <li>NoteAlong is new and still changing. Features may change, break or be removed. It is provided as it is: the notes, words and timings are worked out automatically and can be wrong, so check them by ear.</li>
      </ul>

      <h2>Your account</h2>
      <ul>
        <li>An account is for one person. You sign in with Google or with a link sent to your email, so keep that account safe.</li>
        <li>You can delete your account at any time from the account page. That removes everything in it.</li>
        <li>We may suspend an account that breaks these terms or puts the service or other people at risk.</li>
      </ul>

      <h2>Songs you add</h2>
      <ul>
        <li>Only upload songs you have the right to use for your own practice, such as music you bought or your own recordings. You are responsible for what you upload.</li>
        <li>What you add stays yours and is private to you. You let NoteAlong store it and process it to make your practice part (the backing track, the notes and the words). We don&apos;t share it, publish it or use it for anything else.</li>
        <li>NoteAlong has no way to share your uploads with other people. Don&apos;t use it to copy or distribute music you don&apos;t have the rights to.</li>
      </ul>

      <h2>Built-in songs</h2>
      <p>The songs in Discover are in the public domain or released under Creative Commons licences. Each song page names its licence and the people to credit.</p>

      <h2>Don&apos;t</h2>
      <ul>
        <li>Try to reach other people&apos;s songs or data, or get around the free limit (for example with several accounts).</li>
        <li>Overload, attack, scrape or reverse engineer the service.</li>
        <li>Upload anything illegal or anything that isn&apos;t music or speech.</li>
      </ul>

      <h2>Liability</h2>
      <p>As far as the law allows, NoteAlong isn&apos;t liable for indirect losses, lost data or lost profits arising from using it, and its total liability is limited to what you paid for it (nothing, on the free tier). Nothing here limits rights you have by law that can&apos;t be limited. [The governing law and courts are to be set by a lawyer.]</p>

      <h2>Changes and contact</h2>
      <p>If these terms change, we&apos;ll show the new date here and tell you by email for anything important. Questions: [owner&apos;s contact email].</p>
    </LegalPage>
  );
}
