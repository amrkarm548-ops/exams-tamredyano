import { GoogleGenAI } from '@google/genai';
import { db } from './firebase';
import { doc, getDoc, setDoc } from 'firebase/firestore';

// Feature can be 'extract' or 'chat'
export const getSafeGenAI = async (feature: 'extract' | 'chat') => {
    try {
        const docRef = doc(db, 'api_keys', feature);
        const snap = await getDoc(docRef);
        let keys: string[] = [];
        let currentIndex = 0;

        if (snap.exists()) {
            const data = snap.data();
            keys = data.keys || [];
            currentIndex = data.currentIndex || 0;
        }

        if (keys.length === 0) {
           // Fallback to env variable if no keys in DB
           if (process.env.GEMINI_API_KEY) {
               return { ai: new GoogleGenAI({ apiKey: process.env.GEMINI_API_KEY }), keyUsed: 'env' };
           }
           throw new Error('No API keys configured');
        }

        const nextIndex = (currentIndex + 1) % keys.length;
        // Fire and forget update to rotate for the next request
        setDoc(docRef, { currentIndex: nextIndex }, { merge: true }).catch(console.error);

        return { 
            ai: new GoogleGenAI({ apiKey: keys[currentIndex] }), 
            keyUsed: keys[currentIndex],
            allKeys: keys,
            currentIndex,
            feature
        };
    } catch(e) {
        if (process.env.GEMINI_API_KEY) {
            return { ai: new GoogleGenAI({ apiKey: process.env.GEMINI_API_KEY }), keyUsed: 'env' };
        }
        throw e;
    }
};

export const generateContentWithRetry = async (feature: 'extract' | 'chat', request: any, maxRetries = 3, initialDelayMs = 1000) => {
    // If we're in the browser, route the request through our backend proxy
    // to bypass CORS and SDK browser restrictions.
    if (typeof window !== 'undefined') {
        const res = await fetch('/api/proxy-gemini', {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({ feature, request, maxRetries, initialDelayMs })
        });
        const data = await res.json();
        
        if (!res.ok) {
            const err = new Error(data.error || 'Server error');
            (err as any).status = res.status;
            (err as any).usedConfig = data.usedConfig;
            throw err;
        }
        return { text: data.text }; // Return a mock GenerateContentResponse
    }

    // Server-side execution
    let delay = initialDelayMs;
    let currentAIEnv = await getSafeGenAI(feature);

    for (let i = 0; i < maxRetries; i++) {
        try {
            return await currentAIEnv.ai.models.generateContent(request);
        } catch (error: any) {
            const is503 = error?.status === "UNAVAILABLE" || error?.status === 503 || error?.message?.includes("503");
            const is429 = error?.status === "RESOURCE_EXHAUSTED" || error?.status === 429 || error?.message?.includes("429");
            const is500 = error?.status === "INTERNAL" || error?.status === 500 || error?.message?.includes("500");
            
            if ((is503 || is429 || is500) && i < maxRetries - 1) {
                console.warn(`[Gemini API] Error ${error?.status || 'API Error'} using key ${currentAIEnv.keyUsed}, retrying with next key in ${delay}ms... (Attempt ${i + 1} of ${maxRetries})`);
                await new Promise(resolve => setTimeout(resolve, delay));
                delay *= 2; // Exponential backoff
                currentAIEnv = await getSafeGenAI(feature);
                continue;
            }
            // Throw error with the last used config so caller can see it
            error.usedConfig = { keyUsed: currentAIEnv.keyUsed, feature: currentAIEnv.feature };
            throw error;
        }
    }
    throw new Error('generateContentWithRetry failed');
};

export const recordKeyUsage = async (feature: string, keyUsed: string) => {
    if (keyUsed === 'env' || !keyUsed) return;
    try {
        const { increment } = await import('firebase/firestore');
        const docRef = doc(db, 'api_keys', feature);
        await setDoc(docRef, { usage: { [keyUsed]: increment(1) } }, { merge: true });
    } catch (e) {
        console.error("Failed to record key usage", e);
    }
};

export const reportFailedKey = async (feature: 'extract' | 'chat', failedKey: string) => {
    if (failedKey === 'env') return; // Cannot rotate env key
    const docRef = doc(db, 'api_keys', feature);
    const snap = await getDoc(docRef);
    if (!snap.exists()) return;
    
    const data = snap.data();
    const keys = data.keys || [];
    const currentIndex = data.currentIndex || 0;

    // If the failed key is currently the active one, rotate it
    if (keys[currentIndex] === failedKey) {
        const nextIndex = (currentIndex + 1) % keys.length;
        await setDoc(docRef, { currentIndex: nextIndex }, { merge: true });
        console.warn(`Rotated API key for ${feature} to index ${nextIndex}`);
    }
};
