import React, { createContext, useState, useContext, useEffect, useCallback } from 'react';

const LanguageContext = createContext();

export const LanguageProvider = ({ children }) => {
  const [language, setLanguage] = useState(() => {
    return localStorage.getItem('appLanguage') || 'vi';
  });

  useEffect(() => {
    // Inject Google Translate script only once
    if (!document.getElementById('google-translate-script')) {
      const addScript = document.createElement('script');
      addScript.id = 'google-translate-script';
      addScript.src = '//translate.google.com/translate_a/element.js?cb=googleTranslateElementInit';
      addScript.async = true;
      document.body.appendChild(addScript);

      window.googleTranslateElementInit = () => {
        new window.google.translate.TranslateElement({
          pageLanguage: 'vi',
          includedLanguages: 'en,vi',
          autoDisplay: false
        }, 'google_translate_element');
      };
    }

    // Force language on load if it's stored as 'en'
    if (language === 'en') {
      const gtransVal = '/vi/en';
      document.cookie = `googtrans=${gtransVal}; path=/; domain=${window.location.hostname}`;
      if (document.cookie.indexOf(`googtrans=${gtransVal}`) === -1) {
        document.cookie = `googtrans=${gtransVal}; path=/`;
      }
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  const toggleLanguage = useCallback(() => {
    const nextLang = language === 'vi' ? 'en' : 'vi';
    setLanguage(nextLang);
    localStorage.setItem('appLanguage', nextLang);
    
    // Set Google translate cookie
    const val = nextLang === 'en' ? '/vi/en' : '/vi/vi';
    document.cookie = `googtrans=${val}; path=/; domain=${window.location.hostname}`;
    document.cookie = `googtrans=${val}; path=/`;

    // Try triggering the widget directly to avoid reload if possible
    const select = document.querySelector('.goog-te-combo');
    if (select) {
      select.value = nextLang;
      select.dispatchEvent(new Event('change'));
    } else {
      // Fallback: reload page to apply cookie
      window.location.reload();
    }
  }, [language]);

  // Keep t() as a pass-through for Vietnamese text since Google handles translation
  // This allows us to keep the existing t() calls in the codebase without errors
  const t = (key, params = {}, defaultVi = key) => {
    let text = defaultVi;
    Object.keys(params).forEach(k => {
      text = text.replace(new RegExp(`{${k}}`, 'g'), params[k]);
    });
    return text;
  };

  return (
    <LanguageContext.Provider value={{ language, toggleLanguage, t }}>
      {/* Hidden google translate widget anchor */}
      <div id="google_translate_element" style={{ display: 'none' }}></div>
      
      {/* Hide the top banner from Google Translate using CSS */}
      <style>{`
        /* Force body top to 0 */
        body { top: 0 !important; }
        
        /* Hide all variations of the Google Translate banner */
        .goog-te-banner-frame { display: none !important; }
        .goog-te-banner-frame.skiptranslate { display: none !important; }
        iframe.goog-te-banner-frame { display: none !important; }
        
        /* Hide newer Google Translate widget classes */
        .VIpgJd-ZVi9od-ORHb-OEVmcd { display: none !important; }
        .VIpgJd-ZVi9od-aZ2wEe-wOHMyf { display: none !important; }
        
        /* Hide tooltips and highlights */
        .goog-tooltip { display: none !important; }
        .goog-tooltip:hover { display: none !important; }
        .goog-text-highlight { background-color: transparent !important; border: none !important; box-shadow: none !important; }
        
        /* Hide the skip translate wrapper if it pushes content down */
        #goog-gt-tt, .goog-te-balloon-frame { display: none !important; }
      `}</style>
      
      {children}
    </LanguageContext.Provider>
  );
};

export const useLanguage = () => useContext(LanguageContext);
