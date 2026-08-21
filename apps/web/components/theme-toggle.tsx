"use client";

export function ThemeToggle() {
  function toggleTheme() {
    const next = document.documentElement.dataset.theme !== "dark";
    document.documentElement.dataset.theme = next ? "dark" : "light";
    window.localStorage.setItem("hzense-theme", next ? "dark" : "light");
  }

  return (
    <button className="theme-toggle" type="button" onClick={toggleTheme} aria-label="切换亮色或暗色主题">
      <span aria-hidden="true">◐</span>
    </button>
  );
}
