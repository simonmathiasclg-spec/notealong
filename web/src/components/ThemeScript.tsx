// Applies the saved theme before paint to avoid a flash. Dark is the default stage.
export function ThemeScript() {
  const code = `(function(){try{var t=localStorage.getItem('na.theme');if(!t){t=matchMedia('(prefers-color-scheme: light)').matches?'light':'dark'}document.documentElement.dataset.theme=t}catch(e){document.documentElement.dataset.theme='dark'}})();`;
  return <script dangerouslySetInnerHTML={{ __html: code }} />;
}
