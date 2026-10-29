// Applies the saved theme before paint to avoid a flash. Runs inline.
export function ThemeScript() {
  const code = `(function(){try{var t=localStorage.getItem('na.theme');if(!t){t=matchMedia('(prefers-color-scheme: dark)').matches?'dark':'light'}document.documentElement.dataset.theme=t}catch(e){}})();`;
  return <script dangerouslySetInnerHTML={{ __html: code }} />;
}
