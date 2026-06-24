import React, { createContext, useContext, useState, useEffect, useCallback } from 'react';
import i18n from '../language/i18n';
import { useTranslation } from 'react-i18next';


interface LanguageContextType {
    language: string;
    setLanguage: (lang: string) => void;
    t: (key: string) => string;
}

const LanguageContext = createContext<LanguageContextType>({
    language: 'en',
    setLanguage: () => {},
    t: (key: string) => key,
});


export const LanguageProvider: React.FC<{ children: React.ReactNode }> = ({ children }) => {
    const [language, setLanguageState] = useState('en');
    const { t: i18n_t } = useTranslation();

    
    useEffect(() => {
        const loadLanguage = async () => {
            try {
                const savedLanguage = await window.ipcRenderer?.invoke('get-setting', 'language');
                if (savedLanguage) {
                    setLanguageState(savedLanguage);
                    i18n.changeLanguage(savedLanguage);
                }
            } catch (e) {
                console.warn('Failed to load language setting:', e);
            }
        };
        loadLanguage();
    }, []);

    const setLanguage = useCallback(async (lang: string) => {
        setLanguageState(lang);
        i18n.changeLanguage(lang);
        try {
            await window.ipcRenderer?.invoke('set-setting', 'language', lang);
        } catch (e) {
            console.warn('Failed to save language setting:', e);
        }
    }, []);

    
    const t = useCallback((key: string): string => {
        return i18n_t(key);
    }, [i18n_t]);

    return (
        <LanguageContext.Provider value={{ language, setLanguage, t }}>
            {children}
        </LanguageContext.Provider>
    );
};


export const useLanguage = () => useContext(LanguageContext);

export default LanguageContext;
