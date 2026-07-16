// js/theme.js
// Handles Light / Dark theme toggling and persists selection in localStorage.
// Also implements PWA install prompts.
(function() {
  const currentTheme = localStorage.getItem("theme") || "dark";
  document.documentElement.setAttribute("data-theme", currentTheme);

  // PWA Install Prompt Logic
  let deferredPrompt;
  window.addEventListener('beforeinstallprompt', (e) => {
    // Prevent the mini-infobar from appearing on mobile
    e.preventDefault();
    // Stash the event so it can be triggered later.
    deferredPrompt = e;
    // Show install button if present in DOM
    const installBtn = document.getElementById("installAppBtn");
    if (installBtn) {
      installBtn.style.display = "inline-flex";
    }
  });

  window.addEventListener('appinstalled', (evt) => {
    console.log('PWA was installed successfully!');
    const installBtn = document.getElementById("installAppBtn");
    if (installBtn) {
      installBtn.style.display = "none";
    }
  });

  window.addEventListener("DOMContentLoaded", () => {
    const themeBtn = document.getElementById("themeToggleBtn");
    if (themeBtn) {
      // Set initial button text/icon
      const updateButtonText = (theme) => {
        if (theme === "light") {
          themeBtn.innerHTML = `
            <svg class="logout-icon" fill="none" stroke="currentColor" viewBox="0 0 24 24" xmlns="http://www.w3.org/2000/svg" style="width: 1.1rem; height: 1.1rem; margin-right: 0.35rem; display: inline-block; vertical-align: middle;"><path stroke-linecap="round" stroke-linejoin="round" stroke-width="2" d="M20.354 15.354A9 9 0 018.646 3.646 9.003 9.003 0 0012 21a9.003 9.003 0 008.354-5.646z"></path></svg>
            Dark Mode
          `;
        } else {
          themeBtn.innerHTML = `
            <svg class="logout-icon" fill="none" stroke="currentColor" viewBox="0 0 24 24" xmlns="http://www.w3.org/2000/svg" style="width: 1.1rem; height: 1.1rem; margin-right: 0.35rem; display: inline-block; vertical-align: middle;"><path stroke-linecap="round" stroke-linejoin="round" stroke-width="2" d="M12 3v1m0 16v1m9-9h-1M4 12H3m15.364-6.364l-.707.707M6.343 17.657l-.707.707m12.728 0l-.707-.707M6.343 6.343l-.707-.707m12.728 12.728A9 9 0 115.636 5.636 9 9 0 0118.364 18.364z"></path></svg>
            Light Mode
          `;
        }
      };

      updateButtonText(currentTheme);

      themeBtn.addEventListener("click", () => {
        const activeTheme = document.documentElement.getAttribute("data-theme");
        const newTheme = activeTheme === "light" ? "dark" : "light";
        
        document.documentElement.setAttribute("data-theme", newTheme);
        localStorage.setItem("theme", newTheme);
        updateButtonText(newTheme);
      });
    }

    // Wire up the install button click
    const installBtn = document.getElementById("installAppBtn");
    if (installBtn) {
      if (deferredPrompt) {
        installBtn.style.display = "inline-flex";
      }

      installBtn.addEventListener('click', async () => {
        if (!deferredPrompt) return;
        deferredPrompt.prompt();
        const { outcome } = await deferredPrompt.userChoice;
        console.log(`User response to the install prompt: ${outcome}`);
        deferredPrompt = null;
        installBtn.style.display = "none";
      });
    }
  });
})();
