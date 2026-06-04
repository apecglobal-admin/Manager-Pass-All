(function () {
  const config = window.APECGLOBAL_CONFIG || {};
  let client = null;

  async function loadSupabaseLibrary() {
    if (window.supabase) return window.supabase;
    await new Promise((resolve, reject) => {
      const script = document.createElement('script');
      script.src = runtimeUrl('/vendor/supabase.js');
      script.onload = resolve;
      script.onerror = () => reject(new Error('Cannot load Supabase client library'));
      document.head.appendChild(script);
    });
    return window.supabase;
  }

  function runtimeUrl(path) {
    const apiBaseUrl = String(config.apiBaseUrl || '').trim().replace(/\/$/, '');
    if (!apiBaseUrl || /^https?:\/\//i.test(path)) return path;
    return `${apiBaseUrl}${path.startsWith('/') ? path : `/${path}`}`;
  }

  window.ApecSupabase = {
    isConfigured() {
      return Boolean(config.supabaseUrl && config.supabaseAnonKey);
    },
    async getClient() {
      if (!this.isConfigured()) return null;
      if (client) return client;
      const supabaseGlobal = await loadSupabaseLibrary();
      client = supabaseGlobal.createClient(config.supabaseUrl, config.supabaseAnonKey, {
        auth: {
          persistSession: false,
          autoRefreshToken: false,
          detectSessionInUrl: true
        }
      });
      return client;
    },
    getConfig() {
      return {
        supabaseUrl: config.supabaseUrl || '',
        hasAnonKey: Boolean(config.supabaseAnonKey)
      };
    }
  };
})();
