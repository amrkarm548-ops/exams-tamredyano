import { useState, useEffect, useRef } from 'react';
import { useNavigate } from 'react-router-dom';
import { motion, AnimatePresence } from 'motion/react';
import { GoogleGenAI } from '@google/genai';
import * as pdfjsLib from 'pdfjs-dist';
import mammoth from 'mammoth';
import { 
  FileText, Database, Activity, ShieldAlert, Settings, 
  Plus, Check, Trash, Upload, Search, Users, AlertTriangle, Play, Edit, ScanText, FileQuestion, BookOpen, UserCheck, LayoutDashboard, CloudUpload, Key, Headset, Send, X, Bot, MessageCircle, RefreshCw, UploadCloud, DownloadCloud, LogOut
} from 'lucide-react';

// @ts-ignore
import workerUrl from 'pdfjs-dist/build/pdf.worker.min.mjs?url';
pdfjsLib.GlobalWorkerOptions.workerSrc = workerUrl;

import { db } from '@/src/lib/firebase';
import { getSafeGenAI, reportFailedKey, generateContentWithRetry } from '@/src/lib/gemini';
import { safeJsonParseArray } from '@/src/lib/jsonRepair';
import { collection, getDocs, addDoc, updateDoc, deleteDoc, doc, serverTimestamp, setDoc, getDoc, query, orderBy, onSnapshot, Timestamp, writeBatch } from 'firebase/firestore';
import { useAuth } from '../context/AuthContext';
import { toast } from 'react-hot-toast';
import { BarChart, Bar, XAxis, YAxis, CartesianGrid, Tooltip, Legend, ResponsiveContainer, LineChart, Line } from 'recharts';

export default function AdminDashboard() {
  const navigate = useNavigate();
  const { isAdmin, logout } = useAuth();
  const [adminName, setAdminName] = useState('');
  const [activeTab, setActiveTab] = useState('overview');
  const [loading, setLoading] = useState(false);
  const [dataOutdated, setDataOutdated] = useState(false);
  const lastFetchTime = useRef(Date.now());

  const getStudentDisplayName = (studentId: string, providedName?: string) => {
      let finalName = providedName;
      if (!finalName) {
          const user = users.find(u => u.id === studentId);
          if (user && user.fullName) finalName = user.fullName;
      }
      
      if (finalName && typeof finalName === 'string') {
          if (finalName.startsWith('dummy_')) finalName = finalName.replace('dummy_', '');
          return finalName;
      }

      if (studentId?.startsWith('dummy_')) return studentId.replace('dummy_', '') + ' (تجاوز)';
      if (studentId?.startsWith('student_')) return 'طالب بدون حساب (رابط عام أو مباشر)';
      return studentId || 'غير معروف';
  };

  const getBankDisplayName = (bankId?: string, providedName?: string) => {
      let finalName = providedName;
      if (!finalName && bankId) {
          const bank = banks.find(b => b.id === bankId);
          if (bank && bank.name) finalName = bank.name;
      }
      if (finalName && typeof finalName === 'string') {
          if (finalName.includes('dummy_')) finalName = finalName.replace('dummy_', '');
          return finalName;
      }
      return bankId ? bankId : 'غير معروف';
  };

  useEffect(() => {
    const unsub = onSnapshot(doc(db, 'admin_system', 'last_action'), (snap) => {
       if (snap.exists()) {
          const t = snap.data().timestamp;
          if (t && t > lastFetchTime.current) {
             setDataOutdated(true);
          }
       }
    });
    return () => unsub();
  }, []);

  const notifyAdmins = async () => {
    try {
      await setDoc(doc(db, 'admin_system', 'last_action'), { timestamp: Date.now() });
    } catch(e) {}
  };

  // States
  const [drafts, setDrafts] = useState<any[]>([]);
  const [banks, setBanks] = useState<any[]>([]);
  const [reports, setReports] = useState<any[]>([]);
  const [examResults, setExamResults] = useState<any[]>([]);
  const [liveQuestions, setLiveQuestions] = useState<any[]>([]);
  const [studentsCount, setStudentsCount] = useState(0);
  const [users, setUsers] = useState<any[]>([]);
  const [strikes, setStrikes] = useState<any[]>([]);
  const [allowedStudents, setAllowedStudents] = useState<any[]>([]);
  const [feedbacks, setFeedbacks] = useState<any[]>([]);
  // Support Chats state
  const [supportChats, setSupportChats] = useState<any[]>([]);
  const [selectedChatId, setSelectedChatId] = useState<string | null>(null);
  const [adminReply, setAdminReply] = useState('');

  // Bulk Selection States
  const [selectedDrafts, setSelectedDrafts] = useState<string[]>([]);
  const [selectedStudents, setSelectedStudents] = useState<string[]>([]);
  const [selectedLiveQs, setSelectedLiveQs] = useState<string[]>([]);
  const [selectedLiveBankFilter, setSelectedLiveBankFilter] = useState('');
  const [confirmDialog, setConfirmDialog] = useState<{message: string, onConfirm: () => void} | null>(null);
  const [promptDialog, setPromptDialog] = useState<{message: string, defaultValue: string, onConfirm: (val: string) => void} | null>(null);
  const [selectedBankToConfigure, setSelectedBankToConfigure] = useState<any | null>(null);

  const [draftBankFilter, setDraftBankFilter] = useState('');
  const [onlineSearchTerm, setOnlineSearchTerm] = useState('');
  const [extractTargetBankId, setExtractTargetBankId] = useState('');

  const getDefaultDateString = () => {
    const d = new Date();
    d.setDate(d.getDate() + 30);
    // Return YYYY-MM-DDThh:mm for datetime-local input
    return d.toISOString().slice(0, 16);
  };
  const [expiryDateVal, setExpiryDateVal] = useState(getDefaultDateString());

  const [globalMessageInput, setGlobalMessageInput] = useState('');
  const [allowAllNames, setAllowAllNames] = useState(false);

  useEffect(() => {
    const unsub = onSnapshot(doc(db, 'admin_system', 'global_settings'), (snap) => {
        if (snap.exists()) {
            setGlobalMessageInput(snap.data().global_alert_message || '');
            setAllowAllNames(snap.data().allow_all_names || false);
        }
    });
    return () => unsub();
  }, []);

  const getRemainingDays = (expiresAt: any) => {
    if (!expiresAt) return 'صلاحية مفتوحة ∞';
    let expiryDate: Date;
    if (expiresAt && typeof expiresAt.toDate === 'function') {
      expiryDate = expiresAt.toDate();
    } else {
      expiryDate = new Date(expiresAt);
    }
    const diffTime = expiryDate.getTime() - Date.now();
    if (diffTime <= 0) return 'منتهية ❌';
    const diffDays = Math.ceil(diffTime / (1000 * 60 * 60 * 24));
    return `متبقي ${diffDays} يوم ⏳`;
  };

  const handleRenewStudent = async (studentId: string) => {
    try {
      const d = new Date();
      d.setDate(d.getDate() + 30);
      d.setHours(23, 59, 59, 999);
      await updateDoc(doc(db, 'allowed_students', studentId), { expiresAt: Timestamp.fromDate(d) });
      setAllowedStudents(prev => prev.map(s => s.id === studentId ? { ...s, expiresAt: Timestamp.fromDate(d) } : s));
      alert('تم تجديد صلاحية الطالب لمدة 30 يوم بنجاح!');
    } catch (e) {
      console.error(e);
      alert('فشل التجديد');
    }
  };


  // Name Extractor State
  const [extractingNames, setExtractingNames] = useState(false);
  const [extractedNames, setExtractedNames] = useState<string[]>([]);
  const [newStudentName, setNewStudentName] = useState('');

  // API Keys state
  const [extractKeys, setExtractKeys] = useState<string[]>([]);
  const [extractKeysUsage, setExtractKeysUsage] = useState<Record<string, number>>({});
  const [chatKeys, setChatKeys] = useState<string[]>([]);
  const [chatKeysUsage, setChatKeysUsage] = useState<Record<string, number>>({});
  const [newExtractKey, setNewExtractKey] = useState('');
  const [newChatKey, setNewChatKey] = useState('');

  // Manual Draft State
  const [showManualForm, setShowManualForm] = useState(false);
  const [manualForm, setManualForm] = useState({ text: '', options: ['', '', '', ''], correct: 0, explanation: '', bankId: '' });

  // Extraction State
  const [extractTextAsIs, setExtractTextAsIs] = useState('');
  const [extractTextSmart, setExtractTextSmart] = useState('');
  const [extractFileAsIs, setExtractFileAsIs] = useState<{base64: string, mimeType: string} | null>(null);
  const [extractFileSmart, setExtractFileSmart] = useState<{base64: string, mimeType: string} | null>(null);
  const [questionDifficulty, setQuestionDifficulty] = useState('medium');
  const [extraInstructions, setExtraInstructions] = useState('');
  const [questionCount, setQuestionCount] = useState(5);
  const [generating, setGenerating] = useState(false);
  const [extractedQuestions, setExtractedQuestions] = useState<any[]>([]);

  // Draft Editor State
  const [editingDraftId, setEditingDraftId] = useState<string | null>(null);
  const [editForm, setEditForm] = useState<any>(null);

  useEffect(() => {
    if (!isAdmin) {
      if (!localStorage.getItem('tamrediano_admin')) { // Fallback if context missing
        navigate('/login');
        return;
      }
    }
    const admin = localStorage.getItem('tamrediano_admin') || 'المدير العام';
    setAdminName(admin);
    fetchData();
  }, [navigate, isAdmin]);

  useEffect(() => {
    let intervalId: NodeJS.Timeout;
    if (activeTab === 'bans') {
      const fetchUsersOnly = async () => {
         try {
           const { collection, getDocs, getDoc, doc } = await import('firebase/firestore');
           const studentsSnap = await getDocs(collection(db, 'users'));
           setUsers(studentsSnap.docs.map(d => ({ id: d.id, ...d.data() })));
           const strikesSnap = await getDocs(collection(db, 'strikes'));
           setStrikes(strikesSnap.docs.map(d => ({ id: d.id, ...d.data() })));
         } catch(e){}
      };
      // Fetch immediately on tab open to ensure freshness
      fetchUsersOnly();
      intervalId = setInterval(fetchUsersOnly, 3 * 60 * 1000); // every 3 minutes
    }
    return () => clearInterval(intervalId);
  }, [activeTab]);

  const fetchData = async () => {
    setLoading(true);
    lastFetchTime.current = Date.now();
    setDataOutdated(false);
    try {
      // Fetch Banks
      const banksSnap = await getDocs(collection(db, 'banks'));
      setBanks(banksSnap.docs.map(d => ({ id: d.id, ...d.data() })));
      
      // Fetch Drafts
      const draftsSnap = await getDocs(collection(db, 'drafts'));
      setDrafts(draftsSnap.docs.map(d => ({ id: d.id, ...d.data() })));

      // Fetch Reports
      const reportsSnap = await getDocs(collection(db, 'reports'));
      setReports(reportsSnap.docs.map(d => ({ id: d.id, ...d.data() })));

      // Fetch Exam Results
      const resultsSnap = await getDocs(collection(db, 'exam_results'));
      setExamResults(resultsSnap.docs.map(d => ({ id: d.id, ...d.data() })));

      // Fetch Live Questions
      const qsSnap = await getDocs(collection(db, 'live_banks'));
      setLiveQuestions(qsSnap.docs.map(d => ({ id: d.id, ...d.data() })));

      // Fetch Allowed Students
      const allowedSnap = await getDocs(collection(db, 'allowed_students'));
      setAllowedStudents(allowedSnap.docs.map(d => ({ id: d.id, ...d.data() })));

      // Fetch Students
      const studentsSnap = await getDocs(collection(db, 'users'));
      setStudentsCount(studentsSnap.size);
      setUsers(studentsSnap.docs.map(d => ({ id: d.id, ...d.data() })));

      const strikesSnap = await getDocs(collection(db, 'strikes'));
      setStrikes(strikesSnap.docs.map(d => ({ id: d.id, ...d.data() })));
      
      // Fetch Feedbacks
      const feedbacksSnap = await getDocs(collection(db, 'exam_feedback'));
      setFeedbacks(feedbacksSnap.docs.map(d => ({ id: d.id, ...d.data() })));

      const unsubscribeChats = onSnapshot(query(collection(db, 'support_chats'), orderBy('createdAt', 'asc')), (snap) => {
          setSupportChats(snap.docs.map(d => ({ id: d.id, ...d.data() })));
      });

      // Fetch API Keys
      const ekSnap = await getDoc(doc(db, 'api_keys', 'extract'));
      if(ekSnap.exists()) { 
          setExtractKeys(ekSnap.data().keys || []); 
          setExtractKeysUsage(ekSnap.data().usage || {});
      }
      const ckSnap = await getDoc(doc(db, 'api_keys', 'chat'));
      if(ckSnap.exists()) { 
          setChatKeys(ckSnap.data().keys || []); 
          setChatKeysUsage(ckSnap.data().usage || {});
      }

    } catch (err) {
      console.error(err);
    }
    setLoading(false);
  };

  const processExtractionResult = async (questionsData: any[], textSetter: (val: string) => void) => {
      if (questionsData && questionsData.length > 0) {
        const newDrafts = [];
        for (const q of questionsData) {
          const docRef = await addDoc(collection(db, 'drafts'), {
            text: q.text,
            options: q.options || [],
            correct: q.correct,
            explanation: q.explanation || "",
            status: 'pending',
            createdAt: serverTimestamp(),
            bankId: extractTargetBankId || ''
          });
          newDrafts.push({
            id: docRef.id,
            text: q.text,
            options: q.options || [],
            correct: q.correct,
            explanation: q.explanation || "",
            status: 'pending',
            bankId: extractTargetBankId || ''
          });
        }
        setDrafts(prev => [...newDrafts, ...prev]);
        textSetter('');
        alert(`تم استخراج وإضافة ${questionsData.length} سؤال إلى المسودة بنجاح!`);
        setActiveTab('drafts');
      } else {
        alert('لم يتم استخراج أسئلة.');
      }
  };

  const handleExtractError = async (err: any, usedConfig: any) => {
      console.error(err);
      const is503 = err?.status === "UNAVAILABLE" || err?.status === 503 || err?.message?.includes("503");
      const is429 = err?.status === "RESOURCE_EXHAUSTED" || err?.status === 429 || err?.message?.includes("429");
      const is401_403 = err?.status === 401 || err?.status === 403 || err?.message?.includes("401") || err?.message?.includes("403") || err?.message?.includes("API_KEY_INVALID") || err?.message?.includes("API key not valid");
      const is400 = err?.status === 400 || err?.message?.includes("400") || err?.status === "INVALID_ARGUMENT";

      if (usedConfig && is401_403) {
          await reportFailedKey(usedConfig.feature, usedConfig.keyUsed);
          alert('فشل العملية: خطأ في المصادقة أدى لتعطل المفتاح الحالي. جرى تدوير المفتاح تلقائياً.\n\nالحلول المقترحة:\n1. انتظر بضع ثوانٍ وحاول مرة أخرى (سيتم استخدام المفتاح التالي).\n2. تأكد من إعداد المفاتيح (API Keys) في تبويب إعدادات بيئة العمل.');
      } else if (is503 || is429) {
          alert('الخدمة تواجه ضغطاً عالياً حالياً (503) أو نفاد سريع للحصة (429).\n\nالحلول المقترحة:\n1. انتظر لدقيقة وحاول الاستخراج من جديد.\n2. حاول تقسيم النص إلى أجزاء أصغر.\n3. أضف المزيد من مفاتيح Gemini لتوزيع الضغط.');
      } else if (is400) {
          alert('خطأ في البيانات (400).\n\nالحلول المقترحة:\n1. قد يكون حجم الملف أو النص كبيراً جداً، قسّمه إلى جزئين.\n2. قد يكون المحتوى مرفوضاً بسبب سياسات أمان جوجل (عنف، طب غير آمن).\n3. أعد صياغة أول فقرة وجرب مرة أخرى.');
      } else {
          alert('فشل العملية: ' + (err?.message || 'غير معروف') + '\n\nالحلول المقترحة:\n1. تأكد من اتصالك بالإنترنت.\n2. حدث الصفحة.\n3. استخدم ملف Word أو Text بدلاً من PDF.');
      }
  };

  const handleExtractQuestionsAsIs = async () => {
    if (!extractTextAsIs.trim()) return;
    setGenerating(true);
    let usedConfig: any = null;
    try {
      const systemInstruction = `Extract ALL MCQs from the provided text exactly as they are. DO NOT modify the questions, options, or explanations. You must parse them into a JSON array format.
CRITICAL RULES:
1. Return strictly JSON array.
2. Structure: [{"text": "...", "options": ["A", "B", "C", "D"], "correct": 0, "explanation": "..."}]
3. If no explanation exists, leave it empty.
4. "correct" must be an integer index (0-3).`;

      const userParts: any[] = [];
      if (extractFileAsIs) {
         userParts.push({ text: systemInstruction });
         userParts.push({ inlineData: { data: extractFileAsIs.base64, mimeType: extractFileAsIs.mimeType } });
         if (extractTextAsIs && !extractTextAsIs.includes("تم إرفاق ملف PDF")) {
             userParts.push({ text: "\nAdditional Text:\n" + extractTextAsIs });
         }
      } else {
         userParts.push({ text: systemInstruction + "\n\nSource Text:\n" + extractTextAsIs });
      }

      const response = await generateContentWithRetry('extract', {
        model: "gemini-1.5-flash",
        contents: [
            { role: "user", parts: userParts }
        ],
        config: { responseMimeType: "application/json" }
      });
      
      let questionsData;
      try {
        questionsData = safeJsonParseArray(response.text);
      } catch (parseError) {
        throw new Error("فشل في تحليل الاستجابة بسبب كبر الحجم. يرجى تقليل كمية النص والمحاولة مرة أخرى.");
      }
      
      await processExtractionResult(questionsData, setExtractTextAsIs);
    } catch (err: any) {
      handleExtractError(err, err.usedConfig || usedConfig);
    }
    setGenerating(false);
  };

  const handleExtractQuestionsSmart = async () => {
    if (!extractTextSmart.trim()) return;
    setGenerating(true);
    let usedConfig: any = null;
    try {
      const systemInstruction = `Extract exactly ${questionCount} nursing MCQs from this text.
Difficulty Level: ${questionDifficulty}.
Additional User Instructions: ${extraInstructions}
CRITICAL RULES:
1. Questions and choices (A,B,C,D) MUST be in English.
2. Explanations should follow user instructions, defaulting to Egyptian Arabic if not specified differently, and cite the source.
3. DO NOT make the correct answer longer or shorter than the other options.
4. DO NOT add brackets or any hints that distinguish the correct answer.
5. Return the result STRICTLY as a JSON array. Structure:
[
  {
    "text": "The English question text",
    "options": ["Option A", "Option B", "Option C", "Option D"],
    "correct": 0,
    "explanation": "شرح التفسير"
  }
]`;

      const userParts: any[] = [];
      if (extractFileSmart) {
         userParts.push({ text: systemInstruction });
         userParts.push({ inlineData: { data: extractFileSmart.base64, mimeType: extractFileSmart.mimeType } });
         if (extractTextSmart && !extractTextSmart.includes("تم إرفاق ملف PDF")) {
             userParts.push({ text: "\nAdditional Text:\n" + extractTextSmart });
         }
      } else {
         userParts.push({ text: systemInstruction + "\n\nSource Text:\n" + extractTextSmart });
      }

      const response = await generateContentWithRetry('extract', {
        model: "gemini-1.5-flash",
        contents: [
            { role: "user", parts: userParts }
        ],
        config: { responseMimeType: "application/json" }
      });
      
      let questionsData;
      try {
        questionsData = safeJsonParseArray(response.text);
      } catch (parseError) {
        throw new Error("فشل في تحليل الاستجابة بسبب كبر الحجم. يرجى تقليل كمية النص والمحاولة مرة أخرى.");
      }
      
      await processExtractionResult(questionsData, setExtractTextSmart);
    } catch (err: any) {
      handleExtractError(err, err.usedConfig || usedConfig);
    }
    setGenerating(false);
  };

  const sendToDrafts = async (q: any, i: number) => {
    try {
      const docRef = await addDoc(collection(db, 'drafts'), {
        ...q,
        status: 'pending',
        createdAt: serverTimestamp()
      });
      setDrafts(prev => [{ id: docRef.id, ...q, status: 'pending' }, ...prev]);
      setExtractedQuestions(prev => prev.filter((_, idx) => idx !== i));
    } catch (err) {
      console.error(err);
    }
  };

  const startEditingDraft = (draft: any) => {
    setEditingDraftId(draft.id);
    setEditForm({ ...draft });
  };

  const saveDraftEdit = async () => {
    if (!editingDraftId) return;
    try {
      await setDoc(doc(db, 'drafts', editingDraftId), {
         text: editForm.text,
         options: editForm.options,
         correct: editForm.correct,
         explanation: editForm.explanation,
         status: editForm.status,
         bankId: editForm.bankId || '',
         imageUrl: editForm.imageUrl || null
      }, { merge: true });
      setDrafts(prev => prev.map(d => d.id === editingDraftId ? { ...d, ...editForm } : d));
      setEditingDraftId(null);
    } catch (err) {
      console.error(err);
      alert('فشل حفظ التعديلات');
    }
  };

  const publishDraftToLive = async (draft: any, bankId: string) => {
    if (!bankId) {
      alert('الرجاء اختيار بنك للأسئلة');
      return;
    }
    setConfirmDialog({
        message: 'هل أنت متأكد من النشر في البنك الفعلي؟ ستظهر للطلاب.',
        onConfirm: async () => {
            try {
              const docRef = await addDoc(collection(db, 'live_banks'), {
                bankId,
                text: draft.text,
                options: draft.options,
                correct: draft.correct,
                explanation: draft.explanation,
                imageUrl: draft.imageUrl || null,
                createdAt: serverTimestamp()
              });
              await deleteDoc(doc(db, 'drafts', draft.id));
              setDrafts(prev => prev.filter(d => d.id !== draft.id));
              setLiveQuestions(prev => [{ id: docRef.id, bankId, text: draft.text, options: draft.options, correct: draft.correct, explanation: draft.explanation, imageUrl: draft.imageUrl || null }, ...prev]);
            } catch (err) {
              console.error(err);
              alert('فشل النشر');
            }
        }
    });
  };

  const retractToDraft = async (liveQ: any) => {
    setConfirmDialog({
        message: 'إرجاع السؤال للمسودة؟ (سيختفي من اختبارات الطلاب)',
        onConfirm: async () => {
            try {
              const docRef = await addDoc(collection(db, 'drafts'), {
                text: liveQ.text,
                options: liveQ.options,
                correct: liveQ.correct,
                explanation: liveQ.explanation,
                status: 'retracted',
                createdAt: serverTimestamp(),
                bankId: liveQ.bankId || ''
              });
              await deleteDoc(doc(db, 'live_banks', liveQ.id));
              setLiveQuestions(prev => prev.filter(q => q.id !== liveQ.id));
              setDrafts(prev => [{ id: docRef.id, text: liveQ.text, options: liveQ.options, correct: liveQ.correct, explanation: liveQ.explanation, status: 'retracted', bankId: liveQ.bankId || '' }, ...prev]);
            } catch (err: any) {
              console.error(err);
              alert(`فشل إرجاع السؤال للمسودة: ${err?.message || err}`);
            }
        }
    });
  };

  const deleteExamResult = (id: string) => {
    setConfirmDialog({ message: 'حذف النتيجة نهائياً؟', onConfirm: async () => {
      try {
        await deleteDoc(doc(db, 'exam_results', id));
        setExamResults(prev => prev.filter(r => r.id !== id));
      } catch (err: any) {
        console.error(err);
        alert('فشل حذف النتيجة');
      }
    }});
  };

  const deleteLiveQuestion = (id: string) => {
    setConfirmDialog({ message: 'حذف السؤال نهائياً؟', onConfirm: async () => {
      try {
        await deleteDoc(doc(db, 'live_banks', id));
        setLiveQuestions(prev => prev.filter(q => q.id !== id));
      } catch (err: any) {
        console.error("Firebase deletion failed:", err);
        alert(`فشل الحذف من قاعدة البيانات: ${err?.message || err}`);
      }
    }});
  };

  const deleteDraft = (id: string) => {
    setConfirmDialog({ message: 'حذف المسودة؟', onConfirm: async () => {
      try {
        await deleteDoc(doc(db, 'drafts', id));
        setDrafts(prev => prev.filter(d => d.id !== id));
      } catch (err: any) {
        console.error("Firebase deletion failed:", err);
        alert(`فشل الحذف من قاعدة البيانات: ${err?.message || err}`);
      }
    }});
  };

  const deleteBank = async (id: string, name: string) => {
      setConfirmDialog({ message: `هل أنت متأكد من حذف البنك "${name}" نهائياً وحذف جميع الأسئلة والمسودات التابعة له؟`, onConfirm: async () => {
        setLoading(true);
        try {
          const qsToDeleteItem = liveQuestions.filter(q => q.bankId === id).map(q => q.id);
          const draftsToDeleteItem = drafts.filter(d => d.bankId === id).map(d => d.id);
          const resultsToDeleteItem = examResults.filter(r => r.bankId === id).map(r => r.id);
          const allToDelete = [
             ...qsToDeleteItem.map(qid => ({ col: 'live_banks', id: qid })), 
             ...draftsToDeleteItem.map(did => ({ col: 'drafts', id: did })),
             ...resultsToDeleteItem.map(rid => ({ col: 'exam_results', id: rid }))
          ];
          
          const chunks = [];
          for (let i = 0; i < allToDelete.length; i += 400) {
            chunks.push(allToDelete.slice(i, i + 400));
          }
          
          for (const chunk of chunks) {
            const batch = writeBatch(db);
            for (const item of chunk) {
              batch.delete(doc(db, item.col, item.id));
            }
            await batch.commit();
          }
          
          await deleteDoc(doc(db, 'banks', id));
          setBanks(prev => prev.filter(b => b.id !== id));
          setLiveQuestions(prev => prev.filter(q => q.bankId !== id));
          setDrafts(prev => prev.filter(d => d.bankId !== id));
          setExamResults(prev => prev.filter(r => r.bankId !== id));
          notifyAdmins();
        } catch (err: any) {
          console.error("Firebase deletion failed:", err);
          alert(`فشل الحذف من قاعدة البيانات: ${err?.message || err}`);
        } finally {
          setLoading(false);
        }
      }});
  };

  const createBank = () => {
    setPromptDialog({ message: 'اسم البنك أو القسم:', defaultValue: '', onConfirm: async (name) => {
      const res = await addDoc(collection(db, 'banks'), { name, createdAt: serverTimestamp() });
      setBanks(prev => [...prev, { id: res.id, name }]);
      notifyAdmins();
    }});
  };

  const handleFileUpload = async (e: React.ChangeEvent<HTMLInputElement>, type: 'as-is' | 'smart') => {
    const file = e.target.files?.[0];
    if (!file) return;

    const setFn = type === 'as-is' ? setExtractTextAsIs : setExtractTextSmart;
    const setFileFn = type === 'as-is' ? setExtractFileAsIs : setExtractFileSmart;

    try {
      if (file.name.endsWith('.txt') || file.name.endsWith('.md')) {
        const reader = new FileReader();
        reader.onload = (evt) => {
          setFn(evt.target?.result as string);
        };
        reader.readAsText(file);
      } else if (file.name.endsWith('.pdf')) {
        setFn(`[تم إرفاق ملف PDF: ${file.name}]\nسيتم إرسال الملف كاملاً للاستخراج الذكي بدلاً من قراءة النص فقط لحل مشكلة الجداول والتنسيقات.`);
        const pdfBase64 = await new Promise<string>((resolve) => {
            const reader = new FileReader();
            reader.onload = (evt) => resolve((evt.target?.result as string).split(',')[1]);
            reader.readAsDataURL(file);
        });
        setFileFn({ base64: pdfBase64, mimeType: "application/pdf" });
      } else if (file.name.endsWith('.docx')) {
        setFn('جاري قراءة ملف الـ DOCX... يرجى الانتظار.');
        const arrayBuffer = await file.arrayBuffer();
        const result = await mammoth.extractRawText({ arrayBuffer });
        setFn(result.value);
      } else {
        alert('صيغة الملف غير مدعومة.');
      }
    } catch (error) {
      console.error("File parsing error:", error);
      alert('حدث خطأ أثناء قراءة الملف. يرجى المحاولة باستخدام ملف .txt بدلاً منه.');
      setFn('');
    }
  };

  const handleBanStudent = async (userId: string, userName?: string) => {
    setConfirmDialog({ message: `هل أنت متأكد من حظر الطالب ${userName || userId} نهائياً ومنع دخوله؟`, onConfirm: async () => {
        try {
          await setDoc(doc(db, 'strikes', userId), { count: 10, banned: true }, { merge: true });
          fetchData();
          notifyAdmins();
          alert('تم حظر الطالب بنجاح.');
        } catch (e) {
          console.error(e);
          alert('فشل حظر الطالب');
        }
    }});
  };

  const handleUnban = async (userId: string) => {
    setConfirmDialog({ message: 'هل أنت متأكد من فك الحظر عن هذا الطالب؟', onConfirm: async () => {
        try {
          await setDoc(doc(db, 'users', userId), { ips: [] }, { merge: true });
          await setDoc(doc(db, 'strikes', userId), { count: 0, banned: false }, { merge: true });
          fetchData();
          notifyAdmins();
        } catch (e) {
          console.error(e);
          alert('فشل فك الحظر');
        }
    }});
  };

  const bulkDeleteStudents = async () => {
    setConfirmDialog({ message: `هل أنت متأكد من حذف ${selectedStudents.length} طالب مسموح؟`, onConfirm: async () => {
      setLoading(true);
      try {
        const chunks = [];
        for (let i = 0; i < selectedStudents.length; i += 400) {
          chunks.push(selectedStudents.slice(i, i + 400));
        }
        for (const chunk of chunks) {
          const batch = writeBatch(db);
          for (const id of chunk) {
            batch.delete(doc(db, 'allowed_students', id));
          }
          await batch.commit();
        }
        setAllowedStudents(prev => prev.filter(u => !selectedStudents.includes(u.id)));
        setSelectedStudents([]);
      } catch (err: any) {
        console.error(err);
        alert('فشل الحذف المجمع: ' + err.message);
      } finally {
        setLoading(false);
      }
    }});
  };

  const bulkDeleteDrafts = async () => {
    if(!confirm(`هل أنت متأكد من حذف ${selectedDrafts.length} مسودة؟`)) return;
    setLoading(true);
    try {
      const chunks = [];
      for (let i = 0; i < selectedDrafts.length; i += 400) {
        chunks.push(selectedDrafts.slice(i, i + 400));
      }
      for (const chunk of chunks) {
        const batch = writeBatch(db);
        for (const id of chunk) {
          batch.delete(doc(db, 'drafts', id));
        }
        await batch.commit();
      }
      setDrafts(prev => prev.filter(d => !selectedDrafts.includes(d.id)));
      setSelectedDrafts([]);
    } catch (err) {
      console.error(err);
      alert('فشل الحذف');
    } finally {
      setLoading(false);
    }
  };

  const bulkPublishDrafts = async (targetBankId: string) => {
    if(!targetBankId) return alert('الرجاء اختيار البنك المستهدف');
    setLoading(true);
    try {
        const draftsToPublish = drafts.filter(d => selectedDrafts.includes(d.id));
        const chunks = [];
        for (let i = 0; i < draftsToPublish.length; i += 400) {
            chunks.push(draftsToPublish.slice(i, i + 400));
        }

        for (const chunk of chunks) {
            const batch = writeBatch(db);
            for (const draft of chunk) {
                const liveRef = doc(collection(db, 'live_banks'));
                batch.set(liveRef, { 
                  text: draft.text, 
                  options: draft.options, 
                  correct: draft.correct, 
                  explanation: draft.explanation || '', 
                  imageUrl: draft.imageUrl || '', 
                  bankId: targetBankId,
                  createdAt: serverTimestamp()
                });
                batch.delete(doc(db, 'drafts', draft.id));
            }
            await batch.commit();
        }
        
        setDrafts(prev => prev.filter(d => !selectedDrafts.includes(d.id)));
        setSelectedDrafts([]);
        alert('تم النشر بنجاح! راجع "البنوك النهائية"');
        fetchData();
        notifyAdmins();
    } catch(err) {
        console.error(err);
        alert('حدث خطأ أثناء النشر');
    } finally {
        setLoading(false);
    }
  };

  const publishEntireDraftBank = async (targetBankId: string) => {
    if (!targetBankId) return alert('الرجاء اختيار المجلد المستهدف');
    const bName = banks.find(b => b.id === targetBankId)?.name || '';
    if (!confirm(`هل أنت متأكد من نشر جميع مسودات المجلد "${bName}" للطلاب؟`)) return;
    
    setLoading(true);
    try {
      const draftsToPublish = drafts.filter(d => d.bankId === targetBankId);
      if (draftsToPublish.length === 0) {
        alert("لا توجد مسودات منسوبة لهذا المجلد!");
        setLoading(false);
        return;
      }
      
      const chunks = [];
      for (let i = 0; i < draftsToPublish.length; i += 400) {
          chunks.push(draftsToPublish.slice(i, i + 400));
      }

      for (const chunk of chunks) {
          const batch = writeBatch(db);
          for (const draft of chunk) {
              const liveRef = doc(collection(db, 'live_banks'));
              batch.set(liveRef, { 
                bankId: targetBankId,
                text: draft.text,
                options: draft.options,
                correct: draft.correct,
                explanation: draft.explanation || '',
                imageUrl: draft.imageUrl || '',
                createdAt: serverTimestamp()
              });
              batch.delete(doc(db, 'drafts', draft.id));
          }
          await batch.commit();
      }
      
      alert('تم نشر المجلد بالكامل ومتاح للطلاب الآن!');
      fetchData();
      notifyAdmins();
    } catch (err) {
      console.error(err);
      alert('حدث خطأ أثناء النشر');
    }
    setLoading(false);
  };

  const bulkDeleteLiveQsAction = () => {
    setConfirmDialog({ message: `هل أنت متأكد من حذف ${selectedLiveQs.length} سؤال حي؟`, onConfirm: async () => {
      setLoading(true);
      try {
        const chunks = [];
        for (let i = 0; i < selectedLiveQs.length; i += 400) {
          chunks.push(selectedLiveQs.slice(i, i + 400));
        }
        for (const chunk of chunks) {
          const batch = writeBatch(db);
          for (const id of chunk) {
            batch.delete(doc(db, 'live_banks', id));
          }
          await batch.commit();
        }
        setLiveQuestions(prev => prev.filter(q => !selectedLiveQs.includes(q.id)));
        setSelectedLiveQs([]);
      } catch (err: any) {
        console.error(err);
        alert('فشل الحذف المجمع: ' + err.message);
      } finally {
        setLoading(false);
      }
    }});
  };

  const bulkMoveLiveQs = async (targetBankId: string) => {
    if(!targetBankId) return alert('الرجاء اختيار البنك');
    for(const id of selectedLiveQs) {
       await updateDoc(doc(db, 'live_banks', id), { bankId: targetBankId });
    }
    setLiveQuestions(prev => prev.map(q => selectedLiveQs.includes(q.id) ? { ...q, bankId: targetBankId } : q));
    setSelectedLiveQs([]);
    alert('تم النقل بنجاح!');
  };

  const uploadFullBankToFolder = async (e: React.ChangeEvent<HTMLInputElement>, bankId: string) => {
      const file = e.target.files?.[0];
      if (!file) return;

      try {
          let text = '';
          let pdfBase64: string | null = null;
          if (file.name.endsWith('.txt') || file.name.endsWith('.md')) {
            const reader = new FileReader();
            text = await new Promise<string>((resolve) => {
               reader.onload = (evt) => resolve(evt.target?.result as string);
               reader.readAsText(file);
            });
          } else if (file.name.endsWith('.docx')) {
            const arrayBuffer = await file.arrayBuffer();
            const result = await mammoth.extractRawText({ arrayBuffer });
            text = result.value;
          } else if (file.name.endsWith('.pdf')) {
             pdfBase64 = await new Promise<string>((resolve) => {
                  const reader = new FileReader();
                  reader.onload = (evt) => resolve((evt.target?.result as string).split(',')[1]);
                  reader.readAsDataURL(file);
              });
          }
          
          if (!text.trim() && !pdfBase64) { alert('تعذر قراءة النص للملف المرفوع.'); return; }
          alert('جاري تحليل البنك واستخراج الأسئلة بالذكاء الاصطناعي. هذا قد يستغرق بعض الوقت بناءً على حجم الملف.');
          
          let usedConfig: any = null;
          try {
              const systemInstruction = `You are an expert medical exam creator. Extract ALL MCQ questions from the provided text or document.
The questions and choices MUST be in English.
The explanation MUST be in friendly Egyptian Arabic, and MUST end with a citation of the exact source page/section from the uploaded document.
Output MUST be a JSON array of objects without markdown blocks. Do NOT return \`\`\`json. Structure:
[
  {
    "text": "The English question text",
    "options": ["Option A", "Option B", "Option C", "Option D"],
    "correct": 0,
    "explanation": "Explanation in friendly Egyptian Arabic, ending with Source: Page X."
  }
]`;
                const parts: any[] = [{ text: systemInstruction }];
                if (pdfBase64) {
                    parts.push({ inlineData: { data: pdfBase64, mimeType: "application/pdf" } });
                } else if (text) {
                    parts.push({ text: "\n\nSource Text:\n" + text });
                }

                const response = await generateContentWithRetry('extract', {
                  model: "gemini-1.5-flash",
                  contents: [{ role: "user", parts }],
                  config: { responseMimeType: "application/json" }
                });

                let questionsData;
                questionsData = safeJsonParseArray(response.text);

                if (questionsData && questionsData.length > 0) {
                    const liveQs = [];
                    for (const q of questionsData) {
                        const docRef = await addDoc(collection(db, 'live_banks'), {
                          bankId: bankId,
                          text: q.text,
                          options: q.options || [],
                          correct: q.correct,
                          explanation: q.explanation || '',
                          createdAt: serverTimestamp()
                        });
                        liveQs.push({ id: docRef.id, bankId, ...q });
                    }
                    setLiveQuestions(prev => [...prev, ...liveQs]);
                    alert(`تم استخراج ورفع ${liveQs.length} سؤال بنجاح للمجلد الوجهة!`);
                } else {
                    alert('لم يتم استخراج أسئلة. تأكد من محتوى الملف وشكل الأسئلة.');
                }
            } catch (err: any) {
                handleExtractError(err, err.usedConfig || usedConfig);
            }
      } catch (err) {
          console.error(err);
          alert('حدث خطأ أثناء رفع وتحليل البنك.');
      }
      e.target.value = '';
  };

  const calculateFailureRate = (q: any) => {
    const bankExams = examResults.filter(r => r.bankId === q.bankId);
    if (bankExams.length === 0) return 0;
    
    let missedCount = 0;
    const shortText = q.text.substring(0, 50);
    bankExams.forEach(exam => {
        if (exam.incorrectIds && exam.incorrectIds.includes(shortText)) {
            missedCount++;
        }
    });
    
    return (missedCount / bankExams.length) * 100;
  };

  const handleUploadNamesFile = async (e: React.ChangeEvent<HTMLInputElement>) => {
    const file = e.target.files?.[0];
    if (!file) return;

    setExtractingNames(true);
    let text = '';
    let pdfBase64: string | null = null;

    try {
        if (file.name.endsWith('.pdf')) {
            pdfBase64 = await new Promise<string>((resolve) => {
                const reader = new FileReader();
                reader.onload = (evt) => {
                    const result = evt.target?.result as string;
                    resolve(result.split(',')[1]); 
                };
                reader.readAsDataURL(file);
            });
        } else if (file.name.endsWith('.docx')) {
            const arrayBuffer = await file.arrayBuffer();
            const result = await mammoth.extractRawText({ arrayBuffer });
            text = result.value;
        } else {
           text = await new Promise((resolve) => {
               const reader = new FileReader();
               reader.onload = (evt) => resolve(evt.target?.result as string);
               reader.readAsText(file);
           });
        }
        
        if (text || pdfBase64) {
             let usedConfig: any = null;
             try {
                const systemInstruction = `Extract a list of full human names from the provided document.
CRITICAL RULES:
1. The names are in Arabic. You MUST output legible, proper Arabic names. If the embedded text layer seems corrupted with random symbols, reconstruct the actual Arabic names that are visibly written in the document.
2. Ignore numbering, grades, IDs, statuses, headers, and single letters.
3. Return ONLY a valid JSON array of strings.
Example: ["أحمد محمد", "فاطمة علي"]`;
                
                const parts: any[] = [{ text: systemInstruction }];
                
                if (pdfBase64) {
                    parts.push({
                        inlineData: {
                            data: pdfBase64,
                            mimeType: "application/pdf"
                        }
                    });
                } else if (text) {
                    parts.push({ text: "\n\nSource Text:\n" + text });
                }

                const response = await generateContentWithRetry('extract', {
                  model: "gemini-1.5-flash",
                  contents: [
                      { role: "user", parts }
                  ],
                  config: { responseMimeType: "application/json" }
                });
                
                let namesData = safeJsonParseArray(response.text);
                if (namesData && Array.isArray(namesData)) {
                    setExtractedNames(namesData.map((n: any) => String(n).trim()).filter((n: any) => n));
                } else {
                    alert('تعذر استخراج أسماء من الملف.');
                }
             } catch (err: any) {
                 handleExtractError(err, err.usedConfig || usedConfig);
             }
        }
    } catch(err) {
        console.error(err);
        alert('حدث خطأ أثناء قراءة الملف أو استخراج الأسماء.');
    } finally {
        setExtractingNames(false);
    }
  };

  const handleAddAllowedStudent = async (name: string, customExpiry?: string) => {
    if (!name.trim()) return;
    try {
      const expiry = customExpiry || expiryDateVal;
      const expiresAt = new Date(expiry);
      expiresAt.setHours(23, 59, 59, 999);
      const docRef = await addDoc(collection(db, 'allowed_students'), { 
        fullName: name, 
        createdAt: serverTimestamp(),
        expiresAt: Timestamp.fromDate(expiresAt)
      });
      setAllowedStudents(prev => [{ id: docRef.id, fullName: name, expiresAt: Timestamp.fromDate(expiresAt) }, ...prev]);
    } catch(err) { console.error(err); alert("فشل الإضافة"); }
  };

  const handleSaveExtractedNames = async () => {
    for (const name of extractedNames) {
      await handleAddAllowedStudent(name);
    }
    setExtractedNames([]);
    alert("تم اعتماد وإضافة الأسماء بنجاح!");
  };

  const handleDeleteAllowedStudent = (id: string) => {
    setConfirmDialog({ message: 'هل أنت متأكد من مسح الاسم؟', onConfirm: async () => {
      try {
        await deleteDoc(doc(db, 'allowed_students', id));
        setAllowedStudents(prev => prev.filter(s => s.id !== id));
      } catch(err) { console.error(err); alert("فشل الحذف"); }
    }});
  };

  const handleAddApiKey = async (feature: 'extract' | 'chat', key: string) => {
      if (!key.trim()) return;
      try {
          const docRef = doc(db, 'api_keys', feature);
          const snap = await getDoc(docRef);
          let currentKeys = [];
          if (snap.exists()) currentKeys = snap.data().keys || [];
          if (!currentKeys.includes(key)) {
              currentKeys.push(key);
              await setDoc(docRef, { keys: currentKeys }, { merge: true });
              if (feature === 'extract') { setExtractKeys(currentKeys); setNewExtractKey(''); }
              else { setChatKeys(currentKeys); setNewChatKey(''); }
          }
      } catch (e) {
          console.error(e);
          alert('فشل إضافة المفتاح');
      }
  };

  const handleAddApiKeysBatch = async (feature: 'extract' | 'chat', keysToMix: string[]) => {
      try {
          const docRef = doc(db, 'api_keys', feature);
          const snap = await getDoc(docRef);
          let currentKeys = snap.exists() ? snap.data().keys || [] : [];
          let added = false;
          for (const key of keysToMix) {
              if (!currentKeys.includes(key)) {
                  currentKeys.push(key);
                  added = true;
              }
          }
          if (added) {
              await setDoc(docRef, { keys: currentKeys }, { merge: true });
              if (feature === 'extract') setExtractKeys(currentKeys);
              else setChatKeys(currentKeys);
          }
          alert('تمت إضافة المفاتيح بالكامل بنجاح!');
      } catch (e) {
          console.error(e);
          alert('فشل إضافة المفاتيح بالجملة');
      }
  };

  const handleRemoveApiKey = async (feature: 'extract' | 'chat', key: string) => {
      if (!confirm('حذف المفتاح نهائياً؟')) return;
      try {
          const docRef = doc(db, 'api_keys', feature);
          const snap = await getDoc(docRef);
          if (snap.exists()) {
              let currentKeys = snap.data().keys || [];
              currentKeys = currentKeys.filter((k: string) => k !== key);
              await setDoc(docRef, { keys: currentKeys }, { merge: true });
              if (feature === 'extract') setExtractKeys(currentKeys);
              else setChatKeys(currentKeys);
          }
      } catch (e) {
          console.error(e);
          alert('فشل الحذف');
      }
  };

  const handleCreateManualDraft = async () => {
      if (!manualForm.text || manualForm.options.some(o => !o) || !manualForm.explanation) {
          alert('يرجى ملء جميع الحقول!');
          return;
      }
      try {
          const docRef = await addDoc(collection(db, 'drafts'), {
            text: manualForm.text,
            options: manualForm.options,
            correct: manualForm.correct,
            explanation: manualForm.explanation,
            status: 'pending',
            createdAt: serverTimestamp(),
            bankId: manualForm.bankId || ''
          });
          setDrafts(prev => [{
            id: docRef.id,
            text: manualForm.text,
            options: manualForm.options,
            correct: manualForm.correct,
            explanation: manualForm.explanation,
            status: 'pending',
            bankId: manualForm.bankId || ''
          }, ...prev]);
          setShowManualForm(false);
          setManualForm({ text: '', options: ['', '', '', ''], correct: 0, explanation: '', bankId: '' });
          alert('تم إضافة السؤال يدوياً بنجاح!');
      } catch (e) {
          console.error(e);
          toast.error('فشل إضافة السؤال.');
      }
  };

  const updateGlobalSettings = async (updates: any) => {
      try {
          await setDoc(doc(db, 'admin_system', 'global_settings'), updates, { merge: true });
          alert('تم التحديث بنجاح!');
      } catch(e) { console.error(e); }
  };

  const resetAllStudentData = async () => {
      setConfirmDialog({ message: 'تحذير شديد: هل أنت متأكد من رغبتك في حذف جميع نتائج الطلاب، وسجلات دخولهم، والمخالفات، والملاحظات لبدء فصل/تجديد جديد؟', onConfirm: async () => {
          setLoading(true);
          try {
             const allDocsToDelete: object[] = [];
             
             const feedbackSnap = await getDocs(collection(db, 'exam_feedback'));
             const feedbackDocs = feedbackSnap.docs.map(d => ({ col: 'exam_feedback', id: d.id }));
             
             allDocsToDelete.push(...users.map(u => ({ col: 'users', id: u.id })));
             allDocsToDelete.push(...strikes.map(s => ({ col: 'strikes', id: s.id })));
             allDocsToDelete.push(...examResults.map(r => ({ col: 'exam_results', id: r.id })));
             allDocsToDelete.push(...feedbackDocs);

             const chunks = [];
             for (let i = 0; i < allDocsToDelete.length; i += 400) {
               chunks.push(allDocsToDelete.slice(i, i + 400));
             }

             for (const chunk of chunks) {
                const batch = writeBatch(db);
                for (const item of chunk) {
                   batch.delete(doc(db, (item as any).col, (item as any).id));
                }
                await batch.commit();
             }

             setUsers([]);
             setStrikes([]);
             setExamResults([]);
             toast.success("تم تصفير وإعادة تعيين بيانات الطلاب بنجاح!");
          } catch(err: any) {
             console.error("Reset failed", err);
             toast.error(`فشل التصفير: ${err?.message || err}`);
          } finally {
             setLoading(false);
          }
      }});
  };

  return (
    <div className="min-h-screen bg-[#FFFFFF] text-[#121218] flex flex-col md:flex-row font-sans" dir="rtl">
      {/* Mobile Top Bar */}
      <div className="md:hidden h-16 bg-[#FAF9F6] border-b border-gray-200 flex items-center justify-between px-4 sticky top-0 z-40 shadow-sm">
         <h1 className="text-2xl font-serif italic text-[#D4AF37] tracking-wider drop-shadow-sm" style={{ fontFamily: '"Aref Ruqaa", serif' }}>تمريضيانو الإدارة</h1>
         <select 
            value={activeTab} 
            onChange={(e) => setActiveTab(e.target.value)}
            className="bg-white border border-gray-200 text-sm font-bold p-2 text-gray-700 rounded-lg outline-none focus:border-[#D4AF37] shadow-sm max-w-[150px] truncate"
         >
            <option value="overview">نظرة عامة</option>
            <option value="extract">استخراج الأسئلة</option>
            <option value="drafts">إدارة المسودة</option>
            <option value="live">البنوك النهائية</option>
            <option value="reports">التقارير</option>
            <option value="students">إدارة الطلاب</option>
            <option value="bans">الأمن والحظر</option>
            <option value="api_keys">مفاتيح الذكاء</option>
            <option value="support_chats">الدعم الفني</option>
         </select>
      </div>

      {/* Sidebar (Desktop Only) */}
      <aside className="hidden md:flex w-64 bg-[#FAF9F6] border-l border-gray-200 flex-col shadow-[0_4px_20px_rgba(0,0,0,0.05)] sticky top-0 h-screen overflow-y-auto">
        <div className="h-16 flex shrink-0 items-center justify-center border-b border-gray-200">
          <h1 className="text-2xl font-serif italic text-[#D4AF37] tracking-wider drop-shadow-sm" style={{ fontFamily: '"Aref Ruqaa", serif' }}>تمريضيانو الإدارة</h1>
        </div>
        <div className="p-4 flex flex-col gap-2 flex-1">
          <SidebarBtn active={activeTab === 'overview'} onClick={() => setActiveTab('overview')} icon={<LayoutDashboard size={18}/>} text="نظرة عامة (Overview)" />
          <SidebarBtn active={activeTab === 'extract'} onClick={() => setActiveTab('extract')} icon={<ScanText size={18}/>} text="استخراج الأسئلة (Extract AI)" />
          <SidebarBtn active={activeTab === 'drafts'} onClick={() => setActiveTab('drafts')} icon={<FileText size={18}/>} text="إدارة المسودة (Draft Manager)" />
          <SidebarBtn active={activeTab === 'live'} onClick={() => setActiveTab('live')} icon={<Database size={18}/>} text="البنوك النهائية (Live Banks)" />
          <SidebarBtn active={activeTab === 'reports'} onClick={() => setActiveTab('reports')} icon={<Activity size={18}/>} text="التقارير (Reports)" />
          <SidebarBtn active={activeTab === 'students'} onClick={() => setActiveTab('students')} icon={<Users size={18}/>} text="إدارة الطلاب (Students)" />
          <SidebarBtn active={activeTab === 'bans'} onClick={() => setActiveTab('bans')} icon={<ShieldAlert size={18}/>} text="الأمن والحظر (Security/Bans)" />
          <SidebarBtn active={activeTab === 'api_keys'} onClick={() => setActiveTab('api_keys')} icon={<Key size={18}/>} text="مفاتيح الذكاء الاصطناعي (API Keys)" />
          <SidebarBtn active={activeTab === 'support_chats'} onClick={() => setActiveTab('support_chats')} icon={<Headset size={18}/>} text="الدعم الفني (Support Chats)" />
        </div>
        <div className="p-4 shrink-0 flex flex-col gap-3 mt-auto">
          <button 
             onClick={fetchData} 
             className={`w-full py-2 px-3 rounded-xl shadow-sm border font-bold text-sm flex items-center justify-center gap-2 transition-all ${dataOutdated ? 'bg-[#D4AF37] text-white border-[#D4AF37] shadow-[0_0_15px_rgba(212,175,55,0.6)] animate-pulse' : 'bg-white hover:bg-gray-50 border-gray-200 text-gray-700'}`}
          >
             <RefreshCw size={16} className={dataOutdated ? 'animate-spin' : ''} /> 
             {dataOutdated ? 'يوجد تحديثات جديدة! (اضغط لتحديث الداتا)' : 'تحديث البيانات'}
          </button>
          <div className="border-t border-gray-200 text-xs text-gray-500 font-bold flex items-center justify-between pt-4">
            <span>{adminName}</span>
            <button onClick={() => { logout(); navigate('/login'); }} className="hover:text-red-600 transition-colors bg-white px-2 py-1 rounded shadow-sm border border-gray-200">خروج</button>
          </div>
        </div>
      </aside>

      {/* Main Content */}
      <main className="flex-1 p-4 md:p-8 bg-white overflow-x-hidden">
        <div className="max-w-5xl mx-auto">
          
          {loading && <div className="text-center text-[#D4AF37] my-10 font-bold">جاري التحميل...</div>}

          {/* OVERVIEW TAB */}
          {!loading && activeTab === 'overview' && (
            <div className="space-y-6">


              <div className="flex flex-col md:flex-row justify-between items-start md:items-center gap-4">
                 <h2 className="text-2xl font-bold border-b-2 border-[#D4AF37] pb-2 inline-block">نظرة عامة (Overview)</h2>
                 <div className="flex items-center gap-2">
                     <button onClick={async () => {
                        try {
                            await setDoc(doc(db, 'admin_system', 'global_settings'), {
                                force_logout_timestamp: Date.now()
                            }, { merge: true });
                            alert('تم إرسال أمر الطرد التلقائي لجميع الأجهزة!');
                        } catch(e) { console.error(e); }
                     }} className="bg-orange-50 hover:bg-orange-100 text-orange-600 border border-orange-200 px-4 py-2 rounded-xl text-sm font-bold shadow-sm flex items-center gap-2 transition-colors">
                        <LogOut size={16} /> طرد الجميع لمواجهة التسجيل
                     </button>
                     <button onClick={resetAllStudentData} className="bg-red-50 hover:bg-red-100 text-red-600 border border-red-200 px-4 py-2 rounded-xl text-sm font-bold shadow-sm flex items-center gap-2 transition-colors">
                        <Trash size={16} /> تصفير معلومات جميع الطلاب
                     </button>
                 </div>
              </div>

              {/* GLOBAL SETTINGS UI */}
              <div className="bg-blue-50 border border-blue-200 p-6 rounded-3xl mb-6 shadow-sm">
                  <h3 className="font-bold text-blue-800 text-lg mb-4 flex items-center gap-2"><Send size={20} /> تحكم الإدارة (Global Settings)</h3>
                  
                  <div className="grid grid-cols-1 md:grid-cols-2 gap-6">
                      <div className="bg-white p-4 rounded-2xl border border-blue-100 shadow-sm">
                          <label className="block text-sm font-bold text-gray-700 mb-2">رسالة عامة للجميع (تظهر أعلى الموقع)</label>
                          <textarea 
                              value={globalMessageInput}
                              onChange={e => setGlobalMessageInput(e.target.value)}
                              placeholder="اكتب المحتوى الذي ترغب بتوجيهه للطلاب..."
                              className="w-full bg-gray-50 border border-gray-200 p-2 rounded-lg text-sm mb-2 outline-none focus:border-blue-300"
                              rows={2}
                          />
                          <div className="flex gap-2">
                              <button onClick={() => updateGlobalSettings({ global_alert_message: globalMessageInput })} className="bg-blue-600 hover:bg-blue-700 text-white px-4 py-2 rounded-lg text-sm font-bold transition-all flex-1">نشر الرسالة التنبيهية</button>
                              <button onClick={() => { setGlobalMessageInput(''); updateGlobalSettings({ global_alert_message: '' }); }} className="bg-red-50 hover:bg-red-100 text-red-600 px-4 py-2 rounded-lg text-sm font-bold transition-all">إلغاء</button>
                          </div>
                      </div>

                      <div className="bg-white p-4 rounded-2xl border border-blue-100 shadow-sm flex items-center justify-between">
                           <div>
                               <div className="font-bold text-gray-800">السماح لجميع الأسماء بالدخول</div>
                               <div className="text-xs text-gray-500 max-w-[200px] mt-1">يُفعّل هذا الخيار للسماح لأي مستخدم بتسجيل الدخول دون الرجوع لقائمة المسجلين المعتمدة.</div>
                           </div>
                           <button 
                               onClick={() => updateGlobalSettings({ allow_all_names: !allowAllNames })}
                               className={`w-14 h-8 rounded-full flex items-center transition-colors ${allowAllNames ? 'bg-green-500' : 'bg-gray-300'} px-1 shrink-0`}
                           >
                               <div className={`w-6 h-6 bg-white rounded-full shadow-sm transition-transform ${allowAllNames ? 'translate-x-[-1.5rem]' : 'translate-x-0'}`}></div>
                           </button>
                      </div>
                  </div>
              </div>

              <div className="grid grid-cols-1 md:grid-cols-4 gap-6">
                <div className="bg-white p-6 rounded-3xl border border-gray-100 shadow-[0_4px_20px_rgba(0,0,0,0.03)] flex flex-col items-center justify-center text-center">
                   <div className="w-14 h-14 bg-blue-50 text-blue-600 rounded-2xl flex items-center justify-center mb-4"><FileQuestion size={28} /></div>
                   <h3 className="text-gray-500 text-sm font-bold uppercase tracking-widest mb-1">الأسئلة النهائية</h3>
                   <span className="text-4xl font-black text-[#1A1A1A]">{liveQuestions.length}</span>
                </div>
                <div className="bg-white p-6 rounded-3xl border border-gray-100 shadow-[0_4px_20px_rgba(0,0,0,0.03)] flex flex-col items-center justify-center text-center">
                   <div className="w-14 h-14 bg-amber-50 text-[#D4AF37] rounded-2xl flex items-center justify-center mb-4"><FileText size={28} /></div>
                   <h3 className="text-gray-500 text-sm font-bold uppercase tracking-widest mb-1">مسودات معلقة</h3>
                   <span className="text-4xl font-black text-[#1A1A1A]">{drafts.length}</span>
                </div>
                <div className="bg-white p-6 rounded-3xl border border-gray-100 shadow-[0_4px_20px_rgba(0,0,0,0.03)] flex flex-col items-center justify-center text-center">
                   <div className="w-14 h-14 bg-green-50 text-green-600 rounded-2xl flex items-center justify-center mb-4"><UserCheck size={28} /></div>
                   <h3 className="text-gray-500 text-sm font-bold uppercase tracking-widest mb-1">الطلاب المسجلين</h3>
                   <span className="text-4xl font-black text-[#1A1A1A]">{studentsCount}</span>
                </div>
                <div className="bg-white p-6 rounded-3xl border border-gray-100 shadow-[0_4px_20px_rgba(0,0,0,0.03)] flex flex-col items-center justify-center text-center">
                   <div className="w-14 h-14 bg-purple-50 text-purple-600 rounded-2xl flex items-center justify-center mb-4"><Activity size={28} /></div>
                   <h3 className="text-gray-500 text-sm font-bold uppercase tracking-widest mb-1">إجمالي الاختبارات</h3>
                   <span className="text-4xl font-black text-[#1A1A1A]">{examResults.length}</span>
                </div>
              </div>

              {/* Data Visualization */}
              <div className="bg-white p-6 rounded-3xl border border-gray-100 shadow-sm mt-6">
                 <h3 className="font-bold text-gray-800 text-lg mb-6">معدل النجاح الإجمالي بالأقسام</h3>
                 {examResults.length > 0 ? (
                    <div className="h-64 w-full" dir="ltr">
                       <ResponsiveContainer width="100%" height="100%">
                          <BarChart data={banks.map(b => {
                             const bResults = examResults.filter(r => r.bankId === b.id);
                             const avgScore = bResults.length ? Math.round(bResults.reduce((sum, r) => sum + (r.score/r.total)*100, 0) / bResults.length) : 0;
                             return { name: b.name, 'نسبة النجاح': avgScore, 'عدد الاختبارات': bResults.length };
                          }).filter(b => b['عدد الاختبارات'] > 0)}>
                             <CartesianGrid strokeDasharray="3 3" vertical={false} stroke="#E5E7EB" />
                             <XAxis dataKey="name" axisLine={false} tickLine={false} tick={{fill: '#6B7280', fontSize: 12, fontWeight: 'bold'}} />
                             <YAxis width={40} axisLine={false} tickLine={false} tick={{fill: '#6B7280', fontSize: 12}} />
                             <Tooltip cursor={{fill: '#F3F4F6'}} contentStyle={{borderRadius: '12px', border: 'none', boxShadow: '0 4px 6px -1px rgb(0 0 0 / 0.1)'}} />
                             <Legend />
                             <Bar dataKey="نسبة النجاح" fill="#D4AF37" radius={[4, 4, 0, 0]} barSize={40} />
                          </BarChart>
                       </ResponsiveContainer>
                    </div>
                 ) : (
                    <p className="text-center text-gray-400 font-bold py-10">لا توجد بيانات كافية لعرض الإحصائيات.</p>
                 )}
              </div>

              {(() => {
                  const dailyData: Record<string, Set<string>> = {};
                  [...examResults].sort((a,b) => (a.createdAt?.toMillis() || 0) - (b.createdAt?.toMillis() || 0)).forEach(r => {
                      if (!r.createdAt) return;
                      const dateStr = r.createdAt.toDate().toLocaleDateString('ar-EG', { month: 'short', day: 'numeric' });
                      if (!dailyData[dateStr]) dailyData[dateStr] = new Set();
                      dailyData[dateStr].add(r.studentId);
                  });
                  
                  users.forEach(u => {
                      if (!u.lastLogin) return;
                      const dateStr = u.lastLogin.toDate().toLocaleDateString('ar-EG', { month: 'short', day: 'numeric' });
                      if (!dailyData[dateStr]) dailyData[dateStr] = new Set();
                      dailyData[dateStr].add(u.id);
                  });
                  
                  // Sort dates properly by comparing the actual date objects
                  const chartData = Object.keys(dailyData)
                     .sort((a, b) => {
                         const timeA = new Date(a).getTime() || 0;
                         const timeB = new Date(b).getTime() || 0;
                         return timeA - timeB; // Sort ascending
                     })
                     .map(date => ({
                         date,
                         'مستخدمين': dailyData[date].size
                     })).slice(-14);

                  return chartData.length > 0 ? (
                      <div className="bg-white p-6 rounded-3xl border border-gray-100 shadow-sm mt-6 w-full">
                           <h3 className="font-bold text-gray-800 text-lg mb-6">نشاط المستخدمين اليومي</h3>
                           <div className="w-full" dir="ltr">
                               <ResponsiveContainer width="100%" height={250}>
                                   <LineChart data={chartData}>
                                       <CartesianGrid strokeDasharray="3 3" vertical={false} stroke="#E5E7EB" />
                                       <XAxis dataKey="date" axisLine={false} tickLine={false} tick={{fill: '#6B7280', fontSize: 12, fontWeight: 'bold'}} />
                                       <YAxis width={40} axisLine={false} tickLine={false} tick={{fill: '#6B7280', fontSize: 12}} />
                                       <Tooltip cursor={{fill: '#F3F4F6'}} contentStyle={{borderRadius: '12px', border: 'none', boxShadow: '0 4px 6px -1px rgb(0 0 0 / 0.1)'}} />
                                       <Legend />
                                       <Line type="monotone" dataKey="مستخدمين" stroke="#3B82F6" strokeWidth={3} dot={{r: 4, fill: '#3B82F6', strokeWidth: 2, stroke: '#fff'}} activeDot={{r: 6}} />
                                   </LineChart>
                               </ResponsiveContainer>
                           </div>
                      </div>
                  ) : null;
              })()}

              {/* Share Exam Link Card */}
              <div className="bg-gradient-to-r from-amber-50 to-orange-50 border border-amber-200/60 rounded-3xl p-6 flex flex-col items-center justify-between gap-4 shadow-sm">
                <div className="space-y-1 text-right w-full">
                  <h3 className="font-bold text-gray-800 text-base flex items-center gap-2">
                     <span>روابط الامتحانات للطلاب</span>
                     <span className="bg-[#FAF9F6] border border-amber-200 text-[#D4AF37] px-2 py-0.5 rounded text-[10px] font-bold">مباشر ومفعل</span>
                  </h3>
                  <p className="text-xs text-gray-500 font-medium leading-relaxed">انسخ الرابط أدناه وأرسله لطلاب الدفعة ليتمكنوا من الدخول المباشر:</p>
                  
                  <div className="w-full mt-4 space-y-3">
                     <div className="flex flex-col md:flex-row gap-3 items-center w-full">
                         <span className="font-bold text-gray-700 min-w-[200px]">الرابط العام (الرئيسية):</span>
                         <div className="flex-1 bg-white/80 border border-gray-200 rounded-xl px-3 py-2 font-mono text-xs text-gray-600 truncate text-left" dir="ltr">
                           {window.location.origin}
                         </div>
                         <button onClick={() => {
                            navigator.clipboard.writeText(window.location.origin);
                            alert('تم نسخ الرابط العام!');
                         }} className="bg-[#D4AF37] hover:bg-[#C5A059] text-white px-4 py-2 rounded-lg text-xs font-bold transition-colors shadow-sm w-full md:w-auto">نسخ</button>
                     </div>
                     
                     {banks.map(b => {
                        const bankUrl = `${window.location.origin}/login?bank=${b.id}`;
                        const isExpired = b.autoDeleteAt && b.autoDeleteAt < Date.now();
                        return (
                           <div key={b.id} className={`flex flex-col md:flex-row gap-3 items-center w-full border-t border-amber-100 pt-3 ${isExpired ? 'opacity-60' : ''}`}>
                               <span className="font-bold text-[#D4AF37] min-w-[200px]" title={b.name}>
                                 {b.name}
                                 {isExpired && <span className="text-red-500 text-[10px] mr-2">(مُخفى تلقائياً)</span>}
                               :</span>
                               <div className="flex-1 bg-white/80 border border-gray-200 rounded-xl px-3 py-2 font-mono text-xs text-gray-600 truncate text-left" dir="ltr">
                                 {bankUrl}
                               </div>
                               <button onClick={() => {
                                  navigator.clipboard.writeText(bankUrl);
                                  alert(`تم نسخ رابط بنك ${b.name}!`);
                               }} className="bg-gray-800 hover:bg-gray-900 text-white px-4 py-2 rounded-lg text-xs font-bold transition-colors shadow-sm w-full md:w-auto">نسخ</button>
                           </div>
                        );
                     })}
                  </div>
                </div>
              </div>

            </div>
          )}

          {/* EXTRACT TAB */}
          {!loading && activeTab === 'extract' && (
            <div className="space-y-6">
              <div className="flex items-center justify-between">
                <h2 className="text-2xl font-bold border-b-2 border-[#D4AF37] pb-2 inline-block">معمل استخراج الأسئلة</h2>
              </div>

              <div className="bg-white p-6 rounded-2xl border border-gray-200 shadow-sm mb-6">
                 <label className="block text-sm font-bold text-gray-800 mb-2 font-sans text-right">المجلد/البنك المستهدف لنتائج الاستخراج</label>
                 <select value={extractTargetBankId} onChange={e => setExtractTargetBankId(e.target.value)} className="w-full bg-[#FAF9F6] border border-gray-200 rounded-xl px-4 py-3 text-sm font-bold text-gray-800 outline-none focus:border-[#D4AF37]">
                    <option value="">مسودة غير مصنفة</option>
                    {banks.map(b => <option key={b.id} value={b.id}>{b.name}</option>)}
                 </select>
              </div>
              
              <div className="grid grid-cols-1 lg:grid-cols-2 gap-6">
                  {/* Box 1: File as is */}
                 <div className="bg-white p-6 rounded-2xl border border-gray-200 shadow-sm flex flex-col h-full">
                    <div className="flex items-center gap-2 text-[#D4AF37] mb-2 border-b border-gray-100 pb-3">
                       <ScanText size={20} />
                       <h3 className="font-bold text-gray-800 text-lg">تحليل بنك أسئلة (جاهز)</h3>
                    </div>
                    <p className="text-sm text-gray-500 font-bold mb-4">ارفع أو الصق ملف يحتوي على أسئلة جاهزة. سيتم استخراجها كما هي دون تعديل.</p>

                    <div className="flex-1 flex flex-col gap-4">
                       <div>
                          <textarea 
                             value={extractTextAsIs}
                             onChange={e => setExtractTextAsIs(e.target.value)}
                             className="w-full h-32 bg-[#FAF9F6] border border-gray-200 rounded-xl p-4 text-sm text-gray-900 focus:border-[#D4AF37] resize-none outline-none font-medium text-left"
                             placeholder="الصق نص الأسئلة المشوش هنا..."
                             dir="auto"
                          />
                       </div>
                       <div className="w-full relative">
                          <input type="file" accept=".txt,.md,.pdf,.docx" onChange={(e) => handleFileUpload(e, 'as-is')} className="hidden" id="file-upload-as-is" />
                          <label htmlFor="file-upload-as-is" className="border border-dashed border-gray-300 hover:border-[#D4AF37] bg-white hover:bg-yellow-50 p-4 rounded-xl flex items-center justify-center cursor-pointer transition-colors w-full h-16 gap-2">
                             <CloudUpload size={24} className="text-gray-400" />
                             <span className="text-sm font-bold text-gray-600">اختيار ملف (.pdf, .docx, .txt)</span>
                          </label>
                       </div>
                       
                       <div className="mt-auto pt-4">
                         <button 
                           onClick={handleExtractQuestionsAsIs}
                           disabled={generating || !extractTextAsIs.trim() || extractTextAsIs.includes('جاري قراءة')}
                           className="w-full bg-[#1A1A1A] hover:bg-black text-white font-bold py-3 px-6 rounded-xl shadow-md transition-all duration-300 disabled:opacity-50 h-12 flex items-center justify-center"
                         >
                           {generating ? 'جاري الاستخراج...' : 'استخراج فوري'}
                         </button>
                       </div>
                    </div>
                 </div>

                 {/* Box 2: Smart Generate */}
                 <div className="bg-white p-6 rounded-2xl border border-[#D4AF37]/30 shadow-sm flex flex-col h-full relative overflow-hidden">
                    <div className="absolute top-0 left-0 w-1 h-full bg-[#D4AF37]"></div>
                    <div className="flex items-center gap-2 text-[#D4AF37] border-b border-gray-100 pb-3 mb-2">
                       <Play size={20} />
                       <h3 className="font-bold text-gray-800 text-lg">مربع التحرير (صناعة أسئلة بالذكاء)</h3>
                    </div>
                    <p className="text-sm text-gray-500 font-bold mb-4">ارفع مادة علمية (شرح) ليقوم النظام بصياغة أسئلة منها وتنفيذ تعليماتك.</p>

                    <div className="flex-1 flex flex-col gap-4">
                       <div>
                          <textarea 
                             value={extractTextSmart}
                             onChange={e => setExtractTextSmart(e.target.value)}
                             className="w-full h-24 bg-[#FAF9F6] border border-gray-200 rounded-xl p-4 text-sm text-gray-900 focus:border-[#D4AF37] resize-none outline-none font-medium"
                             placeholder="الصق المادة العلمية (محاضرات، ملخصات) هنا..."
                          />
                       </div>
                       <div className="w-full relative">
                          <input type="file" accept=".txt,.md,.pdf,.docx" onChange={(e) => handleFileUpload(e, 'smart')} className="hidden" id="file-upload-smart" />
                          <label htmlFor="file-upload-smart" className="border border-dashed border-gray-300 hover:border-[#D4AF37] bg-white hover:bg-yellow-50 p-4 rounded-xl flex items-center justify-center cursor-pointer transition-colors w-full h-12 gap-2">
                             <CloudUpload size={20} className="text-gray-400" />
                             <span className="text-sm font-bold text-gray-600">اختر ملف الشرح</span>
                          </label>
                       </div>

                       <div className="grid grid-cols-2 gap-4">
                          <div>
                             <label className="block text-xs font-bold text-gray-600 mb-1">العدد المتوقع</label>
                             <input type="number" min="1" max="250" value={questionCount} onChange={e => setQuestionCount(Number(e.target.value))} className="w-full bg-[#FAF9F6] border border-gray-200 rounded-xl px-3 py-2 text-sm text-center font-bold text-gray-900 outline-none focus:border-[#D4AF37]" />
                          </div>
                          <div>
                             <label className="block text-xs font-bold text-gray-600 mb-1">نسبة الصعوبة</label>
                             <select value={questionDifficulty} onChange={e => setQuestionDifficulty(e.target.value)} className="w-full bg-[#FAF9F6] border border-gray-200 rounded-xl px-3 py-2 text-sm font-bold text-gray-900 outline-none focus:border-[#D4AF37]">
                                <option value="easy">سهل جداً (مباشر)</option>
                                <option value="medium">متوسط</option>
                                <option value="hard">صعب (حالات سريرية)</option>
                             </select>
                          </div>
                       </div>

                       <div>
                          <label className="block text-xs font-bold text-gray-600 mb-1">توجيهات التحرير (اختياري)</label>
                          <textarea 
                             value={extraInstructions}
                             onChange={e => setExtraInstructions(e.target.value)}
                             className="w-full h-16 bg-[#FAF9F6] border border-gray-200 rounded-xl p-3 text-xs focus:border-[#D4AF37] resize-none outline-none font-medium"
                             placeholder="مثال: اجعل التفسير بالمصري، بسط المصطلحات..."
                          />
                       </div>

                       <div className="mt-auto pt-2">
                         <button 
                           onClick={handleExtractQuestionsSmart}
                           disabled={generating || !extractTextSmart.trim() || extractTextSmart.includes('جاري قراءة')}
                           className="w-full bg-gradient-to-r from-[#D4AF37] to-[#C5A059] text-white font-bold py-3 px-6 rounded-xl shadow-lg hover:-translate-y-0.5 transition-all duration-300 disabled:opacity-50 h-12 flex items-center justify-center gap-2"
                         >
                           {generating ? 'جاري الاستخراج...' : 'استخراج بالذكاء الاصطناعي'} <Bot size={18} />
                         </button>
                       </div>
                    </div>
                 </div>
              </div>
            </div>
          )}

          {/* DRAFTS TAB */}
          {!loading && activeTab === 'drafts' && (
            <div className="space-y-6">
              <div className="flex justify-between items-center border-b-2 border-[#D4AF37] pb-2">
                 <div className="flex flex-col sm:flex-row justify-between items-start sm:items-center w-full gap-4 pb-2">
                    <div>
                      <h2 className="text-2xl font-bold mb-1">مسودة الأسئلة (Drafts) {drafts.length > 0 && `(${drafts.filter(d => {
                        if (draftBankFilter === 'uncategorized') return !d.bankId;
                        if (draftBankFilter) return d.bankId === draftBankFilter;
                        return true;
                      }).length})`}</h2>
                      <p className="text-xs text-gray-500 font-bold">رتب مسوداتك داخل مجلدات مستقلة لكل مادة لتجنب تداخل الأسئلة.</p>
                    </div>
                    <div className="flex flex-wrap gap-2 items-center">
                       <select 
                           value={draftBankFilter}
                           onChange={(e) => setDraftBankFilter(e.target.value)}
                           className="bg-white border border-gray-300 rounded-xl px-3 py-2 text-sm font-bold text-gray-800 outline-none focus:border-[#D4AF37] min-w-[160px]"
                       >
                           <option value="">جميع المجلدات (البنوك)</option>
                           <option value="uncategorized">مسودات غير مصنفة</option>
                           {banks.map(b => <option key={b.id} value={b.id}>{b.name}</option>)}
                       </select>
                       {draftBankFilter && draftBankFilter !== 'uncategorized' && (
                          <button 
                            onClick={() => publishEntireDraftBank(draftBankFilter)} 
                            className="bg-[#D4AF37] hover:bg-[#C5A059] text-white px-3 py-2 text-xs font-bold transition-all flex items-center gap-1 shadow-sm h-9"
                          >
                            نشر هذا المجلد بالكامل
                          </button>
                       )}
                    </div>
                 </div>
                 <button onClick={() => setShowManualForm(!showManualForm)} className="bg-[#1A1A1A] hover:bg-black text-white px-4 py-2 rounded-xl text-sm font-bold shadow-md flex items-center gap-2 transition-colors">
                     <Plus size={16} /> إضافة سؤال يدوياً
                 </button>
              </div>

              <AnimatePresence>
                  {showManualForm && (
                      <motion.div initial={{ height: 0, opacity: 0 }} animate={{ height: 'auto', opacity: 1 }} exit={{ height: 0, opacity: 0 }} className="overflow-hidden">
                          <div className="bg-white p-6 rounded-2xl border border-gray-200 shadow-sm mb-6 space-y-4">
                              <h3 className="font-bold text-gray-800 text-lg border-b border-gray-100 pb-2">إنشاء سؤال جديد</h3>
                              <div>
                                 <label className="block text-sm font-bold text-gray-700 mb-1">نص السؤال</label>
                                 <textarea value={manualForm.text} onChange={e => setManualForm({...manualForm, text: e.target.value})} className="w-full bg-[#FAF9F6] border border-gray-200 rounded-xl p-3 text-sm focus:border-[#D4AF37] outline-none h-20" />
                               </div>
                               <div>
                                  <label className="block text-sm font-bold text-gray-700 mb-1">المجلد/البنك المستهدف لهذه المسودة</label>
                                  <select value={manualForm.bankId || ''} onChange={e => setManualForm({...manualForm, bankId: e.target.value})} className="w-full bg-[#FAF9F6] border border-gray-200 rounded-xl px-3 py-2 text-sm text-gray-800 font-bold outline-none focus:border-[#D4AF37]">
                                    <option value="">غير مصنف (Uncategorized)</option>
                                    {banks.map(b => <option key={b.id} value={b.id}>{b.name}</option>)}
                                  </select>
                              </div>
                              <div className="grid grid-cols-1 sm:grid-cols-2 gap-4">
                                  {manualForm.options.map((opt, i) => (
                                      <div key={i}>
                                         <label className="flex top-0 items-center gap-2 text-sm font-bold text-gray-700 mb-1">
                                             <input type="radio" name="manualCorrect" checked={manualForm.correct === i} onChange={() => setManualForm({...manualForm, correct: i})} className="accent-[#D4AF37]" />
                                             الاختيار {String.fromCharCode(65 + i)} {manualForm.correct === i && '(الإجابة الصحيحة)'}
                                         </label>
                                         <input value={opt} onChange={e => {
                                             const newOpts = [...manualForm.options];
                                             newOpts[i] = e.target.value;
                                             setManualForm({...manualForm, options: newOpts});
                                         }} className={`w-full bg-[#FAF9F6] border rounded-xl p-2.5 text-sm focus:border-[#D4AF37] outline-none ${manualForm.correct === i ? 'border-green-400 bg-green-50' : 'border-gray-200'}`} />
                                      </div>
                                  ))}
                              </div>
                              <div>
                                 <label className="block text-sm font-bold text-gray-700 mb-1">التفسير (العربي)</label>
                                 <textarea value={manualForm.explanation} onChange={e => setManualForm({...manualForm, explanation: e.target.value})} className="w-full bg-[#FAF9F6] border border-gray-200 rounded-xl p-3 text-sm focus:border-[#D4AF37] outline-none h-20" />
                              </div>
                              <div className="flex justify-end gap-3 pt-4 border-t border-gray-100">
                                  <button onClick={() => setShowManualForm(false)} className="bg-gray-100 text-gray-700 font-bold py-2 px-6 rounded-xl hover:bg-gray-200 transition-colors text-sm">إلغاء</button>
                                  <button onClick={handleCreateManualDraft} className="bg-[#D4AF37] text-white font-bold py-2 px-6 rounded-xl hover:bg-[#C5A059] shadow-md transition-colors text-sm">حفظ في المسودة</button>
                              </div>
                          </div>
                      </motion.div>
                  )}
              </AnimatePresence>

              <div className="space-y-4">
                {drafts.length > 0 && (
                   <div className="bg-white p-3 rounded-xl border border-gray-200 flex flex-wrap items-center justify-between gap-4 shadow-sm">
                      <label className="flex items-center gap-2 cursor-pointer font-bold text-sm text-gray-700">
                         <input type="checkbox" className="w-4 h-4 accent-[#D4AF37]" 
                                checked={selectedDrafts.length === drafts.length && drafts.length > 0}
                                onChange={() => setSelectedDrafts(selectedDrafts.length === drafts.length ? [] : drafts.map(d => d.id))} />
                         تحديد الكل ({selectedDrafts.length})
                      </label>
                      {selectedDrafts.length > 0 && (
                          <div className="flex gap-2">
                             <select id="bulk-draft-bank" defaultValue="" className="bg-gray-50 border border-gray-200 rounded-lg px-2 text-sm outline-none">
                                <option value="" disabled>اختر بنك لنشر المحدد...</option>
                                {banks.map(b => <option key={b.id} value={b.id}>{b.name}</option>)}
                             </select>
                             <button onClick={() => {
                                 const bankId = (document.getElementById('bulk-draft-bank') as HTMLSelectElement).value;
                                 bulkPublishDrafts(bankId);
                             }} className="bg-[#D4AF37] hover:bg-[#C5A059] text-white px-3 py-1.5 rounded-lg text-xs font-bold transition-colors">نشر المحدد</button>
                             <button onClick={bulkDeleteDrafts} className="bg-red-50 text-red-600 hover:bg-red-100 border border-red-200 px-3 py-1.5 rounded-lg text-xs font-bold transition-colors">حذف المحدد</button>
                          </div>
                      )}
                   </div>
                )}
                {(() => {
                   const filteredDrafts = drafts.filter(d => {
                     if (draftBankFilter === 'uncategorized') return !d.bankId;
                     if (draftBankFilter) return d.bankId === draftBankFilter;
                     return true;
                   });
                   return (
                     <>
                       {filteredDrafts.length === 0 && !showManualForm && <p className="text-gray-500 font-bold text-center py-6 bg-gray-50 rounded-2xl border border-dashed border-gray-200">لا توجد أسئلة مسودة حالياً في هذا المجلد.</p>}
                {filteredDrafts.map(draft => (
                  <div key={draft.id} className={`bg-white p-6 rounded-2xl border ${selectedDrafts.includes(draft.id) ? 'border-[#D4AF37] shadow-md ring-1 ring-[#D4AF37]/50' : 'border-[#D4AF37]/30 shadow-sm'} flex flex-col gap-4 transition-all`}>
                    <div className="flex justify-between items-start gap-4">
                      <label className="flex items-start gap-3 cursor-pointer group flex-1">
                          <input type="checkbox" className="w-5 h-5 mt-1 accent-[#D4AF37]" 
                                 checked={selectedDrafts.includes(draft.id)} 
                                 onChange={() => setSelectedDrafts(prev => prev.includes(draft.id) ? prev.filter(id => id !== draft.id) : [...prev, draft.id])} />
                          <h4 className="font-bold text-lg text-[#121212] leading-relaxed max-w-3xl group-hover:text-[#D4AF37] transition-colors">{draft.text}</h4>
                      </label>
                      <button onClick={() => startEditingDraft(draft)} className="text-[#D4AF37] hover:text-[#C5A059] bg-[#D4AF37]/10 p-2 rounded-xl transition-colors shadow-sm whitespace-nowrap">
                        <Edit size={16} className="inline-block ml-1" /> تعديل
                      </button>
                    </div>
                    <div className="grid grid-cols-2 gap-3" dir="rtl">
                      {draft.options.map((opt: string, i: number) => (
                        <div key={i} className={`p-3 text-sm rounded-xl border font-bold ${draft.correct === i ? 'bg-green-50 border-green-200 text-green-800' : 'bg-[#FAF9F6] border-gray-200 text-gray-600'}`}>
                          {String.fromCharCode(65 + i)}) {opt}
                        </div>
                      ))}
                    </div>
                    <div className="bg-gray-50 border border-gray-100 p-3 rounded-lg text-xs text-gray-600 font-medium">
                      <strong className="text-gray-800 block mb-1">التفسير:</strong>
                      {draft.explanation}
                    </div>
                    <div className="flex flex-col sm:flex-row justify-between items-start sm:items-center mt-2 border-t border-gray-100 pt-4 gap-4">
                      <div className="flex gap-2 items-center flex-1 w-full max-w-xs">
                        <select defaultValue={draft.bankId || ""} id={`bank-select-${draft.id}`} className="flex-1 bg-[#FAF9F6] border border-gray-200 rounded-xl px-3 py-2 text-sm text-gray-800 font-bold outline-none focus:border-[#D4AF37]">
                          <option value="" disabled>البنك المستهدف...</option>
                          {banks.map(b => <option key={b.id} value={b.id}>{b.name}</option>)}
                        </select>
                        <button onClick={() => {
                          const selectEl = document.getElementById(`bank-select-${draft.id}`) as HTMLSelectElement;
                          publishDraftToLive(draft, selectEl.value);
                        }} className="bg-gradient-to-r from-[#D4AF37] to-[#C5A059] text-white font-bold py-3 px-6 rounded-xl shadow-lg hover:shadow-xl hover:-translate-y-1 transition-all duration-300 whitespace-nowrap text-sm">
                          نشر للبنك
                        </button>
                      </div>
                      <button onClick={() => deleteDraft(draft.id)} className="text-red-500 hover:text-red-700 font-bold text-xs px-3 py-2 border border-red-100 bg-red-50 rounded-lg hover:bg-red-100 transition-colors shadow-sm self-end sm:self-auto flex items-center gap-1">
                        <Trash size={14}/> حذف
                      </button>
                    </div>
                  </div>
                ))}
                     </>
                   );
                 })()}
              </div>
            </div>
          )}

          {/* EDIT DRAFT MODAL */}
          <AnimatePresence>
            {editingDraftId && editForm && (
              <motion.div 
                initial={{ opacity: 0 }}
                animate={{ opacity: 1 }}
                exit={{ opacity: 0 }}
                className="fixed inset-0 bg-black/60 backdrop-blur-[2px] z-50 flex items-center justify-center p-4"
              >
                <motion.div
                  initial={{ scale: 0.95, opacity: 0, y: 20 }}
                  animate={{ scale: 1, opacity: 1, y: 0 }}
                  exit={{ scale: 0.95, opacity: 0, y: 20 }}
                  className="bg-white p-8 rounded-3xl w-full max-w-2xl shadow-2xl border border-gray-100 max-h-[90vh] overflow-y-auto"
                >
                  <h2 className="text-2xl font-bold border-b-2 border-[#D4AF37] pb-2 mb-6 inline-block text-[#121212]">تعديل المسودة الشامل</h2>
                  <div className="space-y-5">
                    <div>
                      <label className="block text-sm font-bold text-gray-700 mb-2">السؤال</label>
                      <textarea value={editForm.text} onChange={e => setEditForm({...editForm, text: e.target.value})} className="w-full bg-[#FAF9F6] border border-gray-200 rounded-xl p-4 text-sm focus:border-[#D4AF37] focus:ring-1 focus:ring-[#D4AF37] outline-none h-24 font-medium resize-none shadow-inner" />
                    </div>
                    <div className="grid grid-cols-1 sm:grid-cols-2 gap-5 border-t border-b border-gray-100 py-5">
                      {editForm.options.map((opt: string, idx: number) => (
                        <div key={idx} className="bg-gray-50 p-4 rounded-xl border border-gray-200">
                          <label className="flex items-center justify-between text-xs font-bold text-gray-700 mb-2">
                            <span>الخيار {String.fromCharCode(65 + idx)}</span>
                            <div className="flex items-center gap-1 text-green-600">
                              <input type="radio" name="correct-edit" checked={editForm.correct === idx} onChange={() => setEditForm({...editForm, correct: idx})} className="w-4 h-4 accent-green-600 cursor-pointer" />
                              <span>الإجابة الصحيحة</span>
                            </div>
                          </label>
                          <input type="text" value={opt} onChange={e => {
                            const newOpts = [...editForm.options];
                            newOpts[idx] = e.target.value;
                            setEditForm({...editForm, options: newOpts});
                          }} className="w-full bg-white border border-gray-200 rounded-lg p-3 text-sm focus:border-[#D4AF37] outline-none shadow-sm" />
                        </div>
                      ))}
                    </div>
                    <div>
                       <label className="block text-sm font-bold text-gray-700 mb-2">التفسير والشرح (عربي/مصري)</label>
                       <textarea value={editForm.explanation} onChange={e => setEditForm({...editForm, explanation: e.target.value})} className="w-full bg-[#FAF9F6] border border-gray-200 rounded-xl p-4 text-sm focus:border-[#D4AF37] focus:ring-1 focus:ring-[#D4AF37] outline-none h-28 font-medium resize-none shadow-inner" />
                     </div>

                     <div>
                       <label className="block text-sm font-bold text-gray-700 mb-2">صورة مرفقة (اختياري)</label>
                       {editForm.imageUrl && (
                            <div className="mb-2 relative inline-block">
                                <img src={editForm.imageUrl} alt="مرفق" className="h-32 object-contain rounded-xl border border-gray-200" />
                                <button onClick={() => setEditForm({...editForm, imageUrl: null})} className="absolute -top-2 -right-2 bg-red-500 text-white rounded-full p-1"><X size={14}/></button>
                            </div>
                       )}
                       <div>
                        <label className="cursor-pointer bg-[#FAF9F6] hover:bg-gray-100 border border-gray-200 px-4 py-2 text-sm font-bold rounded-xl inline-flex items-center gap-2 transition-colors">
                          <Upload size={16} className="text-[#D4AF37]" /> اختيار صورة
                          <input type="file" accept="image/*" className="hidden" onChange={(e) => {
                              const file = e.target.files?.[0];
                              if(file) {
                                  const reader = new FileReader();
                                  reader.onloadend = async () => {
                                      setEditForm({...editForm, imageUrl: reader.result});
                                  };
                                  reader.readAsDataURL(file);
                              }
                          }} />
                        </label>
                       </div>
                     </div>

                     <div>
                        <label className="block text-sm font-bold text-gray-700 mb-2">المجلد/البنك المستهدف</label>
                        <select value={editForm.bankId || ''} onChange={e => setEditForm({...editForm, bankId: e.target.value})} className="w-full bg-[#FAF9F6] border border-gray-200 rounded-xl px-3 py-2 text-sm text-gray-800 font-bold outline-none focus:border-[#D4AF37]">
                          <option value="">غير مصنف (Uncategorized)</option>
                          {banks.map(b => <option key={b.id} value={b.id}>{b.name}</option>)}
                        </select>
                    </div>
                    <div className="flex justify-end gap-3 pt-2">
                       <button onClick={() => setEditingDraftId(null)} className="bg-white text-gray-800 border-2 border-[#D4AF37] font-bold py-3 px-6 rounded-xl shadow-md hover:bg-gray-50 transition-all duration-300 text-sm">إلغاء</button>
                       <button onClick={saveDraftEdit} className="bg-gradient-to-r from-[#D4AF37] to-[#C5A059] text-white font-bold py-3 px-6 rounded-xl shadow-lg hover:shadow-xl hover:-translate-y-1 transition-all duration-300 flex items-center gap-2"><Check size={18}/> حفظ التعديلات</button>
                    </div>
                  </div>
                </motion.div>
              </motion.div>
            )}
           </AnimatePresence>

          {/* LIVE BANKS TAB */}
          {!loading && activeTab === 'live' && (
            <div className="space-y-6">
              <div className="flex flex-col md:flex-row items-center justify-between gap-4">
                <h2 className="text-2xl font-bold border-b-2 border-[#D4AF37] pb-2 inline-block">البنوك النهائية للطلاب</h2>
                <div className="flex gap-2 w-full md:w-auto">
                    <button onClick={() => {
                        const element = document.getElementById('live-questions-list');
                        if (element) {
                            // @ts-ignore
                            import('html2pdf.js').then((html2pdf) => {
                                html2pdf.default().set({
                                    margin: 10,
                                    filename: 'live_bank_questions.pdf',
                                    html2canvas: { scale: 2 },
                                    jsPDF: { unit: 'mm', format: 'a4', orientation: 'portrait' }
                                }).from(element).save();
                            });
                        }
                    }} className="bg-white text-gray-800 border-2 border-[#D4AF37] shadow-md hover:shadow-lg hover:-translate-y-1 transition-all duration-300 font-bold py-3 px-6 rounded-xl flex items-center justify-center gap-2 text-sm flex-1 md:flex-none">
                      تحميل الأسئلة PDF
                    </button>
                    <button onClick={createBank} className="bg-gradient-to-r from-[#D4AF37] to-[#C5A059] text-white font-bold py-3 px-6 rounded-xl shadow-lg hover:shadow-xl hover:-translate-y-1 transition-all duration-300 flex items-center justify-center gap-2 text-sm flex-1 md:flex-none">
                      <Plus size={16} /> إضافة مجلد (بنك)
                    </button>
                </div>
              </div>
              <div className="grid grid-cols-2 md:grid-cols-4 gap-4">
                {banks.map(bank => {
                  const pendingDrafts = drafts.filter(d => d.bankId === bank.id).length;
                  return (
                  <div key={bank.id} className="bg-white p-5 rounded-2xl border border-gray-200 shadow-sm flex flex-col items-center justify-between gap-2 hover:border-[#D4AF37]/50 transition-all min-h-[220px]">
                     <div className="flex flex-col items-center gap-2 w-full relative">
                        <button onClick={() => deleteBank(bank.id, bank.name)} className="absolute top-0 right-0 text-gray-400 hover:text-red-500 bg-gray-50 hover:bg-red-50 p-1.5 rounded-lg transition-colors border border-gray-100 shadow-sm z-10" title="حذف المجلد نهائياً">
                           <Trash size={14} />
                        </button>
                        {bank.imageUrl ? (
                           <img src={bank.imageUrl} alt={bank.name} className="w-16 h-12 rounded-lg object-cover shadow-sm" />
                        ) : (
                           <Database className="text-[#D4AF37]" size={28} />
                        )}
                        <h3 className="font-bold text-center text-[14px] text-gray-800 line-clamp-1 w-full" title={bank.name}>{bank.name}</h3>
                        <span className="text-[10px] text-gray-400 font-bold bg-[#FAF9F6] border border-gray-100 px-2 py-0.5 rounded-full">{liveQuestions.filter(q => q.bankId === bank.id).length} سؤال</span>
                     </div>
                     
                     {pendingDrafts > 0 ? (
                        <button 
                          onClick={() => publishEntireDraftBank(bank.id)}
                          className="w-full bg-blue-600 hover:bg-blue-700 text-white px-3 py-2 rounded-lg text-xs font-bold transition-colors text-center shadow-md animate-pulse mt-2"
                        >
                          نشر ({pendingDrafts}) مسودة 🚀
                        </button>
                     ) : (
                        <label className="cursor-pointer text-white bg-[#D4AF37] hover:bg-[#C5A059] px-3 py-1.5 rounded-lg text-xs font-bold transition-colors w-full text-center flex items-center justify-center gap-1 shadow-sm mt-2">
                            <CloudUpload size={12}/> رفع بنك كلي
                            <input type="file" accept=".txt,.md,.pdf,.docx" className="hidden" onChange={(e) => uploadFullBankToFolder(e, bank.id)} />
                        </label>
                     )}
                     
                     <button 
                       onClick={() => setSelectedBankToConfigure(bank)}
                       className="bg-gray-50 hover:bg-gray-100 border border-gray-200 text-gray-700 px-3 py-1.5 rounded-lg text-xs font-bold transition-colors w-full text-center flex items-center justify-center gap-1 mt-1"
                     >
                         <Settings size={12}/> إعدادات البنك
                     </button>
                  </div>
                  );
                })}
              </div>

              <div id="live-questions-list" className="mt-8 space-y-4">
                 <div className="flex justify-between items-center bg-gray-50 p-4 rounded-xl border border-gray-200 shadow-sm flex-wrap gap-4">
                     <h3 className="text-lg font-bold text-gray-800 flex items-center gap-2">قائمة الأسئلة المنشورة ({liveQuestions.length})</h3>
                     <div className="flex items-center gap-3">
                         <label className="flex items-center gap-2 cursor-pointer font-bold text-sm text-gray-700">
                             <input type="checkbox" className="w-4 h-4 accent-[#D4AF37]" 
                                    checked={selectedLiveQs.length === liveQuestions.length && liveQuestions.length > 0}
                                    onChange={() => setSelectedLiveQs(selectedLiveQs.length === liveQuestions.length ? [] : liveQuestions.map(q => q.id))} />
                             تحديد الكل ({selectedLiveQs.length})
                         </label>
                         {selectedLiveQs.length > 0 && (
                            <div className="flex gap-2">
                               <select id="bulk-live-bank" defaultValue="" className="bg-white border border-gray-200 rounded-lg px-2 text-sm outline-none">
                                  <option value="" disabled>انقل المحدد إلى مجلد...</option>
                                  {banks.map(b => <option key={b.id} value={b.id}>{b.name}</option>)}
                               </select>
                               <button onClick={() => {
                                   const bankId = (document.getElementById('bulk-live-bank') as HTMLSelectElement).value;
                                   bulkMoveLiveQs(bankId);
                               }} className="bg-[#D4AF37] hover:bg-[#C5A059] text-white px-3 py-1.5 rounded-lg text-xs font-bold transition-colors">نقل</button>
                               <button onClick={bulkDeleteLiveQsAction} className="bg-red-50 text-red-600 hover:bg-red-100 border border-red-200 px-3 py-1.5 rounded-lg text-xs font-bold transition-colors">حذف المحدد</button>
                            </div>
                         )}
                         <select 
                             value={selectedLiveBankFilter} 
                             onChange={(e) => setSelectedLiveBankFilter(e.target.value)}
                             className="bg-white border border-gray-200 rounded-lg px-3 py-2 text-sm outline-none w-48 font-bold"
                         >
                             <option value="">كل المجلدات (البنوك)</option>
                             {banks.map(b => <option key={b.id} value={b.id}>{b.name}</option>)}
                         </select>
                     </div>
                 </div>
                 
                 {liveQuestions
                    .filter(q => selectedLiveBankFilter === '' || q.bankId === selectedLiveBankFilter)
                    .map((q) => {
                    const failureRate = calculateFailureRate(q);
                    const isHighFailure = failureRate > 60;
                    return (
                    <div key={q.id} className={`p-5 rounded-xl border flex flex-col gap-3 shadow-sm transition-all ${selectedLiveQs.includes(q.id) ? 'border-[#D4AF37] bg-white ring-1 ring-[#D4AF37]/50' : (isHighFailure ? 'border-red-400 bg-red-50' : 'border-gray-200 bg-white')}`}>
                       <div className="flex justify-between items-start">
                          <label className="flex items-start gap-3 cursor-pointer group flex-1">
                              <input type="checkbox" className="w-5 h-5 mt-1 accent-[#D4AF37]" 
                                     checked={selectedLiveQs.includes(q.id)} 
                                     onChange={() => setSelectedLiveQs(prev => prev.includes(q.id) ? prev.filter(id => id !== q.id) : [...prev, q.id])} />
                              <div className="flex flex-col gap-1 max-w-2xl">
                                 {isHighFailure && <span className="bg-red-600 text-white text-[10px] px-2 py-0.5 rounded font-bold self-start mb-1 tracking-wider uppercase">High Failure Rate: {Math.round(failureRate)}%</span>}
                                 <p className={`font-bold text-sm leading-relaxed ${selectedLiveQs.includes(q.id) ? 'text-[#D4AF37]' : 'text-[#121212]'} transition-colors group-hover:text-[#D4AF37]`}>{q.text}</p>
                              </div>
                          </label>
                          <span className="text-[10px] text-gray-500 font-bold bg-gray-100 px-2 py-1 rounded shadow-sm border border-gray-200 whitespace-nowrap ml-2">
                            {banks.find(b => b.id === q.bankId)?.name || 'مجهول'}
                          </span>
                       </div>
                       <div className="flex flex-wrap items-center justify-end gap-2 mt-2 pt-2 border-t border-gray-100">
                          {q.imageUrl && <span className="mr-auto text-xs text-blue-600 font-bold bg-blue-50 px-2 py-1 rounded">يحتوي على صورة</span>}
                          <label className="cursor-pointer text-blue-700 bg-blue-50 hover:bg-blue-100 border border-blue-200 px-3 py-1.5 rounded-lg text-xs font-bold transition-colors shadow-sm">
                             رفع صورة
                             <input type="file" accept="image/*" className="hidden" onChange={(e) => {
                                 const file = e.target.files?.[0];
                                 if (file) {
                                     const reader = new FileReader();
                                     reader.onloadend = async () => {
                                         await updateDoc(doc(db, 'live_banks', q.id), { imageUrl: reader.result });
                                         setLiveQuestions(prev => prev.map(lq => lq.id === q.id ? {...lq, imageUrl: reader.result} : lq));
                                     };
                                     reader.readAsDataURL(file);
                                 }
                             }} />
                          </label>
                          <button onClick={() => retractToDraft(q)} className="text-yellow-700 bg-yellow-50 hover:bg-yellow-100 border border-yellow-200 px-3 py-1.5 rounded-lg text-xs font-bold transition-colors shadow-sm">إرجاع للمسودة (للتعديل)</button>
                          <button onClick={() => deleteLiveQuestion(q.id)} className="text-red-700 bg-red-50 hover:bg-red-100 border border-red-200 px-3 py-1.5 rounded-lg text-xs font-bold transition-colors shadow-sm">حذف نهائي</button>
                       </div>
                    </div>
                 )})}
                 {liveQuestions.length === 0 && <p className="text-gray-500 font-bold text-sm">لا توجد أسئلة منشورة.</p>}
              </div>

              <div className="mt-8 space-y-4">
                 <h3 className="text-lg font-bold text-[#D4AF37]">لوحة الشرف والمراقبة (Leaderboard)</h3>
                 <div className="bg-white rounded-2xl border border-[#D4AF37]/30 overflow-hidden shadow-sm">
                    <table className="w-full text-right text-sm">
                        <thead className="bg-[#FAF9F6] border-b border-gray-200 text-gray-500 text-xs uppercase tracking-widest font-bold">
                            <tr>
                                <th className="p-4">الطالب</th>
                                <th className="p-4">النتيجة</th>
                                <th className="p-4">الوقت المستغرق</th>
                                <th className="p-4">البنك</th>
                                <th className="p-4">إجراء</th>
                            </tr>
                        </thead>
                        <tbody className="divide-y divide-gray-100">
                            {examResults.sort((a,b) => b.score - a.score).slice(0, 50).map((res, idx) => (
                                <tr key={res.id} className="hover:bg-gray-50 transition-colors">
                                    <td className="p-4 font-bold text-[#121212]">{getStudentDisplayName(res.studentId, res.studentName)}</td>
                                    <td className="p-4"><span className="text-[#D4AF37] font-bold">{res.score}</span> / {res.total}</td>
                                    <td className="p-4 text-gray-700 font-medium">
                                        {res.timeTaken} دقيقة
                                        {res.timeTaken < 2 && res.total > 10 && <span className="text-red-500 text-xs pr-2 block">⚠️ وقت غير منطقي</span>}
                                    </td>
                                    <td className="p-4 text-gray-600 font-medium text-xs">{getBankDisplayName(res.bankId, res.bankName)}</td>
                                    <td className="p-4">
                                        <button onClick={() => deleteExamResult(res.id)} className="text-red-500 hover:text-red-700 bg-red-50 hover:bg-red-100 p-2 rounded-lg transition-colors">
                                            <Trash size={16} />
                                        </button>
                                    </td>
                                </tr>
                            ))}
                            {examResults.length === 0 && <tr><td colSpan={5} className="p-6 text-center text-gray-500 font-bold">لا توجد نتائج بعد.</td></tr>}
                        </tbody>
                    </table>
                 </div>
              </div>
            </div>
          )}

          {/* REPORTS TAB */}
          {!loading && activeTab === 'reports' && (
             <div className="space-y-6">
                <h2 className="text-2xl font-bold border-b-2 border-[#D4AF37] pb-2 inline-block">تقارير ونتائج الطلاب</h2>
                <div className="bg-white rounded-2xl border border-gray-200 overflow-hidden shadow-sm">
                   <table className="w-full text-right text-sm">
                       <thead className="bg-[#FAF9F6] border-b border-gray-200 text-gray-500 text-xs uppercase tracking-widest font-bold">
                           <tr>
                               <th className="p-4 rounded-tr-2xl">الطالب</th>
                               <th className="p-4">النتيجة</th>
                               <th className="p-4">الوقت</th>
                               <th className="p-4">البنك (المجلد)</th>
                               <th className="p-4">التاريخ</th>
                               <th className="p-4 rounded-tl-2xl">إجراء</th>
                           </tr>
                       </thead>
                       <tbody className="divide-y divide-gray-100">
                           {examResults.sort((a,b) => (b.createdAt?.toMillis() || 0) - (a.createdAt?.toMillis() || 0)).map((res, idx) => (
                               <tr key={res.id} className="hover:bg-gray-50 transition-colors">
                                   <td className="p-4 font-bold text-[#121212]">{getStudentDisplayName(res.studentId, res.studentName)}</td>
                                   <td className="p-4"><span className="text-green-700 font-bold bg-green-50 px-2.5 py-1 rounded-lg border border-green-200 shadow-sm">{res.score}</span> / {res.total}</td>
                                   <td className="p-4 text-gray-700 font-medium">{res.timeTaken} دقيقة</td>
                                   <td className="p-4 text-gray-600 font-medium text-xs">{getBankDisplayName(res.bankId, res.bankName)}</td>
                                   <td className="p-4 text-gray-400 text-xs font-bold">{res.createdAt?.toDate().toLocaleDateString() || '-'}</td>
                                   <td className="p-4">
                                        <button onClick={() => deleteExamResult(res.id)} className="text-red-500 hover:text-red-700 bg-red-50 hover:bg-red-100 p-2 rounded-lg transition-colors">
                                            <Trash size={16} />
                                        </button>
                                    </td>
                               </tr>
                           ))}
                           {examResults.length === 0 && <tr><td colSpan={6} className="p-6 text-center text-gray-500 font-bold">لا توجد تقارير.</td></tr>}
                       </tbody>
                   </table>
                </div>

                <h2 className="text-2xl font-bold border-b-2 border-[#D4AF37] pb-2 inline-block mt-8">سجل نشاط الإدارة (الشكاوى والإبلاغات)</h2>
                <div className="space-y-4">
                  {reports.length === 0 && <p className="text-gray-500 font-bold">لا توجد شكاوى أو بلاغات حالياً.</p>}
                  {reports.map((report) => (
                     <div key={report.id} className="bg-white p-6 rounded-2xl border border-gray-200 shadow-sm flex flex-col gap-3 hover:border-red-300 transition-colors">
                        <div className="flex justify-between items-start">
                           <h4 className="font-bold text-gray-900 border-b border-gray-100 pb-2 mb-2 w-full">طالب: <span className="text-[#D4AF37]">{getStudentDisplayName(report.studentId, report.studentName)}</span> | بنك: <span className="text-[#D4AF37]">{getBankDisplayName(report.bankId, report.bankName)}</span></h4>
                        </div>
                        <div className="bg-gray-50 p-4 rounded-xl border border-gray-100 space-y-2">
                           <p className="text-sm font-bold text-gray-800 leading-relaxed"><span className="text-[#D4AF37]">نص السؤال:</span> {report.questionText}</p>
                           {report.questionOptions && report.questionOptions.length > 0 && (
                              <div className="text-xs text-gray-600 space-y-1 pr-4 border-r-2 border-gray-200 mt-2">
                                 {report.questionOptions.map((opt: string, i: number) => (
                                    <p key={i} className={i === report.questionAnswerIndex ? "text-green-600 font-bold" : ""}>- {opt} {i === report.questionAnswerIndex && '(الإجابة الصحيحة)'}</p>
                                 ))}
                              </div>
                           )}
                        </div>
                        <p className="text-sm text-red-700 font-bold mt-2 bg-red-50 p-4 rounded-xl border border-red-100 flex items-start gap-2">
                            <AlertTriangle size={18} className="shrink-0" />
                            رسالة الطالب المشتكي: {report.message}
                        </p>
                        {report.aiChatHistory && report.aiChatHistory.length > 0 && (
                           <div className="mt-2 text-xs border border-blue-100 bg-blue-50/50 p-4 rounded-xl">
                              <h5 className="font-bold text-blue-800 mb-2 flex items-center gap-1"><MessageCircle size={14} /> سجل محادثة الذكاء الاصطناعي مع الطالب حول السؤال</h5>
                              <div className="space-y-2 max-h-40 overflow-y-auto custom-scrollbar pr-2">
                                 {report.aiChatHistory.map((msg: any, i: number) => (
                                    <div key={i} className={`p-2 rounded-lg ${msg.role === 'user' ? 'bg-white shadow-sm border border-gray-200 text-gray-800' : 'bg-blue-100 text-blue-900'}`}>
                                       <span className="font-bold text-[10px] uppercase opacity-70 block mb-1">{msg.role === 'user' ? 'الطالب' : 'AI'}</span>
                                       <p className="whitespace-pre-wrap leading-relaxed">{msg.content}</p>
                                    </div>
                                 ))}
                              </div>
                           </div>
                        )}
                        <div className="text-left mt-2 border-t border-gray-100 pt-3">
                           <button onClick={async () => {
                               await deleteDoc(doc(db, 'reports', report.id));
                               setReports(prev => prev.filter(r => r.id !== report.id));
                           }} className="bg-gray-100 hover:bg-red-50 text-gray-600 hover:text-red-600 border border-gray-200 text-xs font-bold py-2 px-6 rounded-xl transition-colors shadow-sm">
                              تمت المعالجة (حذف)
                           </button>
                        </div>
                     </div>
                  ))}
                </div>

                <h2 className="text-2xl font-bold border-b-2 border-[#D4AF37] pb-2 inline-block mt-8">تقييمات وآراء الطلاب</h2>
                <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
                  {feedbacks.length === 0 && <p className="text-gray-500 font-bold">لا توجد تقييمات حالياً.</p>}
                  {feedbacks.sort((a,b) => (b.createdAt?.toMillis() || 0) - (a.createdAt?.toMillis() || 0)).map((fb) => (
                     <div key={fb.id} className="bg-white p-5 rounded-xl border border-gray-200 shadow-sm flex flex-col gap-2">
                        <div className="flex justify-between items-center">
                           <div className="flex flex-col">
                               <span className="font-bold text-gray-900">{getStudentDisplayName(fb.studentId, fb.studentName)}</span>
                               <span className="text-xs text-gray-500 font-bold">بنك: {getBankDisplayName(fb.bankId, fb.bankName)}</span>
                           </div>
                           <span className="text-[#D4AF37] tracking-widest text-lg">{'★'.repeat(fb.rating)}{'☆'.repeat(5 - fb.rating)}</span>
                        </div>
                        {fb.feedback && <p className="text-sm text-gray-600 bg-gray-50 p-3 rounded-lg border border-gray-100 font-medium leading-relaxed italic">"{fb.feedback}"</p>}
                        <span className="text-xs text-gray-400 font-bold">{fb.createdAt?.toDate().toLocaleDateString() || '-'}</span>
                     </div>
                  ))}
                </div>
             </div>
          )}

          {/* STUDENTS MANAGEMENT TAB */}
          {!loading && activeTab === 'students' && (
             <div className="space-y-10">
                <div>
                   <h2 className="text-2xl font-bold border-b-2 border-[#D4AF37] pb-2 inline-block mb-6">الاستخراج الذكي للأسماء</h2>
                   <div className="bg-white p-6 rounded-2xl border border-gray-200 shadow-sm">
                      <p className="text-sm text-gray-500 mb-4 font-bold">ارفع ملف نصي يحتوي على أسماء الدفعة بشكل عشوائي، وسيقوم الذكاء الاصطناعي بتنظيفها واستخراجها.</p>
                      
                      <div className="flex flex-col md:flex-row gap-4 items-center">
                         <div className="flex-1 w-full">
                           <input type="file" accept=".txt,.md,.csv,.pdf,.docx" onChange={handleUploadNamesFile} className="hidden" id="names-upload" />
                           <label htmlFor="names-upload" className="border-2 border-dashed border-[#D4AF37] bg-white hover:bg-yellow-50 p-6 rounded-2xl flex flex-col items-center justify-center cursor-pointer transition-colors w-full h-32">
                             <CloudUpload size={32} className="text-[#D4AF37] mb-2" />
                             <span className="text-sm font-bold text-gray-600">ارفع ملف الأسماء هنا (.txt, .csv, .pdf)</span>
                           </label>
                         </div>
                         {extractingNames && <span className="text-[#D4AF37] text-sm font-bold animate-pulse mt-4 md:mt-0">جاري الاستخراج بالذكاء الاصطناعي...</span>}
                      </div>

                      {extractedNames.length > 0 && (
                         <div className="mt-6 border-t border-gray-100 pt-6">
                            <h3 className="font-bold text-gray-800 mb-4">الأسماء المستخرجة ({extractedNames.length}) - يمكنك التعديل قبل الحفظ</h3>
                            <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 gap-3">
                               {extractedNames.map((name, i) => (
                                  <input 
                                     key={i} 
                                     value={name} 
                                     onChange={(e) => {
                                        const ne = [...extractedNames];
                                        ne[i] = e.target.value;
                                        setExtractedNames(ne);
                                     }}
                                     className="bg-[#FAF9F6] border border-gray-200 rounded-lg px-3 py-2 text-sm focus:border-[#D4AF37] outline-none font-bold"
                                  />
                               ))}
                            </div>
                            <div className="mt-6 flex justify-end gap-3">
                             <button onClick={() => setExtractedNames([])} className="bg-white text-gray-800 border-2 border-[#D4AF37] font-bold py-3 px-6 rounded-xl shadow-md hover:bg-gray-50 transition-all duration-300 text-sm">إلغاء</button>
                               <button onClick={handleSaveExtractedNames} className="bg-gradient-to-r from-[#D4AF37] to-[#C5A059] text-white font-bold py-3 px-6 rounded-xl shadow-lg hover:shadow-xl hover:-translate-y-1 transition-all duration-300 text-sm">حفظ للقائمة</button>
                            </div>
                         </div>
                      )}
                   </div>
                </div>

                <div className="grid grid-cols-1 lg:grid-cols-2 gap-8">
                   {/* Column 1: Allowed Names List */}
                   <div>
                      <div className="flex justify-between items-center mb-4">
                         <h2 className="text-xl font-bold text-gray-800 flex items-center gap-2">
                            قائمة المسموح لهم
                            <span className="bg-gray-100 text-gray-500 px-2 py-0.5 rounded text-xs">{allowedStudents.length}</span>
                         </h2>
                         {selectedStudents.length > 0 && (
                            <button onClick={bulkDeleteStudents} className="bg-red-50 text-red-600 border border-red-200 px-3 py-1 rounded-lg text-xs font-bold transition-colors">
                               حذف المحدد ({selectedStudents.length})
                            </button>
                         )}
                      </div>
                      <div className="bg-white rounded-2xl border border-gray-200 shadow-sm p-4 flex flex-col h-full">
                         <div className="grid grid-cols-1 md:grid-cols-12 gap-3 mb-4">
                            <input 
                               value={newStudentName}
                               onChange={(e) => setNewStudentName(e.target.value)}
                               placeholder="إضافة اسم طالب جديد..."
                               className="col-span-1 md:col-span-5 h-11 bg-[#FAF9F6] border border-gray-200 rounded-xl px-4 text-sm font-bold outline-none focus:border-[#D4AF37]"
                            />
                            <div className="col-span-1 md:col-span-5 flex justify-between gap-2 items-center px-3 bg-[#FAF9F6] border border-gray-200 rounded-xl h-11">
                               <span className="text-[10px] font-bold text-gray-400 whitespace-nowrap">صلاحية اسم المسجل:</span>
                               <input 
                                  type="datetime-local"
                                  value={expiryDateVal}
                                  onChange={(e) => setExpiryDateVal(e.target.value)}
                                  className="bg-transparent border-0 text-[11px] font-bold text-gray-700 outline-none w-full text-left cursor-pointer flex-1"
                               />
                             </div>
                             <button onClick={() => { handleAddAllowedStudent(newStudentName); setNewStudentName(''); }} className="col-span-1 md:col-span-2 bg-[#D4AF37] hover:bg-[#C5A059] text-white py-2 px-2 rounded-xl text-sm font-bold shadow-md h-11 transition-colors w-full flex items-center justify-center text-center">
                               إضافة
                            </button>
                         </div>
                         <div className="flex items-center gap-2 mb-2 px-3">
                             <label className="flex items-center gap-2 cursor-pointer font-bold text-xs text-gray-600">
                                 <input type="checkbox" className="w-3.5 h-3.5 accent-[#D4AF37]" 
                                        checked={selectedStudents.length === allowedStudents.length && allowedStudents.length > 0}
                                        onChange={() => setSelectedStudents(selectedStudents.length === allowedStudents.length ? [] : allowedStudents.map(s => s.id))} />
                                 تحديد الكل
                             </label>
                             {selectedStudents.length > 0 && (
                                <button onClick={() => setSelectedStudents([])} className="mr-auto text-[10px] bg-gray-100 hover:bg-gray-200 text-gray-700 px-2 py-1 rounded transition-colors font-bold shadow-sm">
                                   إلغاء التحديد ({selectedStudents.length})
                                </button>
                             )}
                         </div>
                         <div className="max-h-96 overflow-y-auto pr-2 space-y-2">
                            {allowedStudents.map(student => (
                               <div key={student.id} className={`flex justify-between items-center p-3 border rounded-xl transition-all ${selectedStudents.includes(student.id) ? 'bg-blue-50 border-blue-200' : 'bg-gray-50 border-gray-100'}`}>
                                  <label className="flex items-center gap-3 cursor-pointer flex-1">
                                      <input type="checkbox" className="w-4 h-4 accent-[#D4AF37]" 
                                             checked={selectedStudents.includes(student.id)} 
                                             onChange={() => setSelectedStudents(prev => prev.includes(student.id) ? prev.filter(x => x !== student.id) : [...prev, student.id])} />
                                      <div className="flex flex-col sm:flex-row sm:items-center gap-2">
                                         <span className="font-bold text-[#1A1A1A] text-sm">{student.fullName}</span>
                                         <span className={`text-[10.5px] font-bold px-2 py-1 rounded-lg border ${student.expiresAt && getRemainingDays(student.expiresAt).includes('منتهية') ? 'bg-red-50 border-red-100 text-red-600' : 'bg-[#FAF9F6] border-gray-200 text-gray-700'}`}>
                                            {getRemainingDays(student.expiresAt)}
                                         </span>
                                      </div>
                                  </label>
                                  <button onClick={() => handleRenewStudent(student.id)} className="text-[11px] font-bold text-[#D4AF37] hover:text-[#C5A059] bg-[#D4AF37]/10 hover:bg-[#D4AF37]/20 px-2.5 py-1.5 rounded-lg transition-all ml-2 flex items-center gap-1 shadow-sm" title="تجديد صلاحية الطالب لمدة 30 يوم">
                                      تجديد الصلاحية ⏳
                                   </button>
                                   <button onClick={() => handleDeleteAllowedStudent(student.id)} className="text-red-500 hover:text-red-700 bg-red-50 hover:bg-red-100 p-1.5 rounded-lg transition-colors ml-2" title="إزالة من القائمة المسموحة">
                                     <Trash size={14} />
                                  </button>
                                  <button onClick={() => handleBanStudent(student.id, student.fullName)} className="text-white bg-red-600 hover:bg-red-700 px-2 py-1.5 rounded-lg transition-colors ml-2 text-[11px] font-bold flex items-center gap-1 shadow-sm" title="تعليق / حظر الطالب نهائياً من النظام">
                                     <ShieldAlert size={14} /> حظر
                                  </button>
                               </div>
                            ))}
                            {allowedStudents.length === 0 && <p className="text-center text-sm font-bold text-gray-400 py-4">الدفعة فارغة الداتا.</p>}
                         </div>
                      </div>
                   </div>

                   {/* Column 2: Activity & Access Log */}
                   <div>
                      <h2 className="text-xl font-bold text-gray-800 mb-4">سجل النشاط والدخول (Activity Log)</h2>
                      <div className="bg-white rounded-2xl border border-gray-200 shadow-sm overflow-hidden">
                         <table className="w-full text-right text-sm">
                            <thead className="bg-[#FAF9F6] border-b border-gray-200 text-gray-500 text-[10px] uppercase tracking-widest font-bold">
                                <tr>
                                    <th className="p-3">اسم الطالب (آخر دخول)</th>
                                    <th className="p-3">عناوين IP</th>
                                </tr>
                            </thead>
                            <tbody className="divide-y divide-gray-100">
                                {users.sort((a,b) => (b.lastLogin?.toMillis() || 0) - (a.lastLogin?.toMillis() || 0)).slice(0, 50).map((u, idx) => (
                                   <tr key={u.id} className="hover:bg-gray-50 transition-colors">
                                      <td className="p-3">
                                         <p className="font-bold text-[#121212]">{getStudentDisplayName(u.id, u.fullName)}</p>
                                         <p className="text-[10px] text-gray-400 font-medium">آخر دخول: {u.lastLogin ? u.lastLogin.toDate().toLocaleString() : 'غير متوفر'}</p>
                                         {u.deviceInfo && <p className="text-[10px] text-blue-500 font-bold mt-1 bg-blue-50/50 inline-block px-1 rounded">{u.deviceInfo}</p>}
                                      </td>
                                      <td className="p-3 text-[10px] text-gray-500 leading-relaxed font-mono">
                                         {u.ips?.map((ip: string) => <div key={ip}>{ip}</div>) || 'لا يوجد'}
                                      </td>
                                   </tr>
                                ))}
                                {users.length === 0 && <tr><td colSpan={2} className="p-6 text-center text-gray-500 font-bold">لا توجد سجلات.</td></tr>}
                            </tbody>
                         </table>
                      </div>
                   </div>
                </div>
             </div>
          )}

          {/* BANS TAB */}
          {!loading && activeTab === 'bans' && (
             <div className="space-y-6">
                <div className="flex flex-col md:flex-row justify-between items-start md:items-center gap-4">
                  <h2 className="text-2xl font-bold border-b-2 border-red-600 text-red-600 pb-2 inline-block">الأمن والحظر (Security/Bans)</h2>
                  
                  <div className="relative w-full md:w-64">
                    <input 
                       type="text" 
                       placeholder="بحث في المتواجدين الآن..." 
                       value={onlineSearchTerm}
                       onChange={e => setOnlineSearchTerm(e.target.value)}
                       className="w-full pl-10 pr-4 py-2 bg-white border border-gray-200 rounded-xl text-sm font-bold focus:border-[#D4AF37] outline-none shadow-sm"
                    />
                    <Search className="absolute left-3 top-1/2 -translate-y-1/2 text-gray-400" size={16} />
                  </div>
                </div>

                <div className="grid grid-cols-1 lg:grid-cols-2 gap-6">
                   {/* Banned Users */}
                   <div className="bg-white rounded-3xl border border-gray-100 shadow-sm p-6 overflow-hidden">
                      <h3 className="font-bold text-gray-800 text-lg mb-4 flex items-center gap-2">
                         <ShieldAlert className="text-red-500" size={20}/>
                         الطلاب المحظورين
                      </h3>
                      <div className="flex flex-col gap-3">
                         {users.filter(u => (u.ips && u.ips.length > 3) || strikes.find(s => s.id === u.id)?.banned).map(u => (
                            <div key={u.id} className="bg-red-50 p-4 rounded-2xl border border-red-100 shadow-sm flex flex-col gap-3">
                               <div className="flex items-center gap-3">
                                  <div className="w-10 h-10 bg-red-100 text-red-600 rounded-full flex items-center justify-center shrink-0">
                                     <ShieldAlert size={20} />
                                  </div>
                                  <div>
                                     <h3 className="font-bold text-gray-900 text-sm">{getStudentDisplayName(u.id, u.fullName)}</h3>
                                     <p className="text-[10px] text-red-700 font-bold opacity-80 mt-0.5">محظور من النظام</p>
                                  </div>
                               </div>
                               <button onClick={() => handleUnban(u.id)} className="w-full bg-white hover:bg-gray-50 text-gray-800 border border-gray-200 font-bold py-1.5 rounded-lg shadow-sm text-xs transition-colors mt-auto">
                                  فك الحظر وتسوية الحساب
                               </button>
                            </div>
                         ))}
                         {users.filter(u => (u.ips && u.ips.length > 3) || strikes.find(s => s.id === u.id)?.banned).length === 0 && (
                            <div className="text-center py-8">
                               <ShieldAlert size={32} className="mx-auto text-green-500 mb-2 opacity-50" />
                               <p className="text-gray-500 font-bold text-sm">لا يوجد طلاب محظورين حالياً.</p>
                            </div>
                         )}
                      </div>
                   </div>

                   {/* Online Users */}
                   <div className="bg-white rounded-3xl border border-gray-100 shadow-sm p-6 overflow-hidden flex flex-col h-[500px]">
                      <h3 className="font-bold text-gray-800 text-lg mb-4 flex items-center justify-between">
                         <div className="flex items-center gap-2">
                            <span className="relative flex h-3 w-3">
                              <span className="animate-ping absolute inline-flex h-full w-full rounded-full bg-green-400 opacity-75"></span>
                              <span className="relative inline-flex rounded-full h-3 w-3 bg-green-500"></span>
                            </span>
                            المتواجدون الآن (Live)
                         </div>
                         <span className="text-xs bg-gray-100 text-gray-500 px-2 py-1 rounded-full">تحديث تلقائي كل 3 دقائق</span>
                      </h3>
                      
                      <div className="flex-1 overflow-y-auto space-y-2 pr-2 custom-scrollbar">
                         {(() => {
                            const now = new Date().getTime();
                            const onlineUsers = users.filter(u => {
                               // Assuming lastActive within last 6 minutes (adding a bit of buffer to 3 min)
                               if (!u.lastActive) return false;
                               const activeTime = u.lastActive.toMillis ? u.lastActive.toMillis() : u.lastActive;
                               const isRecentlyActive = (now - activeTime) < 6 * 60 * 1000;
                               return isRecentlyActive;
                            }).filter(u => 
                               onlineSearchTerm === '' || 
                               (u.fullName || '').toLowerCase().includes(onlineSearchTerm.toLowerCase()) ||
                               (u.id || '').toLowerCase().includes(onlineSearchTerm.toLowerCase())
                            );

                            if (onlineUsers.length === 0) {
                               return (
                                  <div className="text-center py-10">
                                     <Users size={32} className="mx-auto text-gray-300 mb-2" />
                                     <p className="text-gray-400 font-bold text-sm">لا يوجد طلاب متصلين حالياً أو لا تُطابق البحث.</p>
                                  </div>
                               );
                            }

                            return onlineUsers.map(u => (
                               <div key={u.id} className="bg-gray-50 border border-gray-100 rounded-xl p-3 flex justify-between items-center hover:bg-[#FAF9F6] transition-colors">
                                  <div>
                                     <h4 className="font-bold text-sm text-gray-800">{getStudentDisplayName(u.id, u.fullName)}</h4>
                                     <p className="text-[10px] text-gray-500 mt-0.5">
                                        نشط منذ {Math.floor((now - (u.lastActive.toMillis ? u.lastActive.toMillis() : u.lastActive)) / 60000)} دقيقة
                                     </p>
                                  </div>
                                  <button onClick={() => handleBanStudent(u.id, u.fullName)} className="text-[10px] font-bold bg-white text-red-600 border border-red-200 px-2 py-1 rounded shadow-sm hover:bg-red-50">
                                     حظر كخطر
                                  </button>
                               </div>
                            ));
                         })()}
                      </div>
                   </div>
                </div>
             </div>
          )}

          {/* API KEYS TAB */}
          {!loading && activeTab === 'api_keys' && (
              <div className="space-y-6">
                <h2 className="text-2xl font-bold border-b-2 border-[#D4AF37] pb-2 inline-block flex items-center gap-2"><Key className="text-[#D4AF37] inline mr-2" size={24} /> نظام تدوير المفاتيح (API Key Manager)</h2>
                <div className="bg-blue-50 border border-blue-200 p-4 rounded-xl text-blue-800 text-sm font-bold flex items-center gap-3">
                   <span>ℹ️</span> 
                   يضمن هذا النظام استمرار عمل المنصة بدون توقف. إذا استهلك مفتاح باقته بالكامل، سيتم التحويل للمفتاح الذي يليه تلقائياً وبشكل مخفي عن الطلاب.
                </div>

                <div className="grid grid-cols-1 md:grid-cols-2 gap-8 mt-6">
                   {/* Extract Keys */}
                   <div className="bg-white rounded-2xl border border-gray-200 shadow-sm p-6">
                      <h3 className="text-lg font-bold text-gray-800 mb-4 border-b border-gray-100 pb-3 flex items-center gap-2"><ScanText size={20} className="text-[#D4AF37]"/> مفاتيح استخراج الأسئلة</h3>
                      <div className="flex gap-2 mb-6">
                          <input 
                              value={newExtractKey}
                              onChange={(e) => setNewExtractKey(e.target.value)}
                              placeholder="أدخل مفتاح Gemini هنا..."
                              className="flex-1 bg-[#FAF9F6] border border-gray-200 rounded-xl px-4 py-2 text-sm outline-none focus:border-[#D4AF37] text-left"
                              dir="ltr"
                          />
                          <button onClick={() => handleAddApiKey('extract', newExtractKey)} className="bg-[#1A1A1A] hover:bg-black text-white px-4 rounded-xl text-sm font-bold shadow-md">+</button>
                          <button onClick={async () => {
                             const batch = ["AIzaSyByAI-G5-YMXTxWtKl95Hb4vVgWnuzaoDI", "AIzaSyDTkoLORzrCO4cTafc7QGlrtGpJ9GoOEJ4", "AIzaSyCo_6_eLCNz2OPiBx17TZpdoJJUd4mlDLU", "AIzaSyDRwlWRVuUCvj5lAadN_cqux_zN-WCg_ZU", "AIzaSyDibCDZ2q95gTP3g2hbhEYDYTmLafhQ9z0", "AIzaSyA32uQYMnHnTQiZLvsUcZ-cHIlidpco5eQ", "AIzaSyCtFeYF9CCNcZ_Exf6JhE5-arMEEAf20vw", "AIzaSyBX3Yk7kSIpdFpsDc7DTFm1oPqa0fVT1Mg", "AIzaSyB9yPQUC_HubFxTyuHKjIF9dhKClj6wox4", "AIzaSyBjlrlw89-hIdegaPfrKykZeWp_7NjOeoI", "AIzaSyDZu5Yz3cn5CTDDTalbTdwIZrlsi4GcL1Y", "AIzaSyDzrh8XieUV_pUFBu0fdovFYAUL_r1NDp8", "AIzaSyAEhAQpr5Pf3YJ8F--NIyCeczjs3WxAXKo", "AIzaSyDMieLans2dIyqIL7WOLC9B-Kt-GS5x0-c", "AIzaSyDlpGJe1KPVtj8u6-bb33gzZbYNWlgspKI", "AIzaSyDNEEzT1bYMQWIo2ZwkBn5MVJg_6LpZwaY", "AIzaSyAe6zhamy6IPPkmGm7Ajhs9Ie4_PY1tlRI", "AIzaSyD1CHSQs6vMa0B-sJUXzDoaqqOzwlXvMRI", "AIzaSyB0MbzM3xxEvwjVPyivjIxl6_cx2BwZP7c", "AIzaSyC7YoZ2SKlVv9gOMoIH4QbeQeKsJ-k5ors", "AIzaSyAlRzN5fhGmZWACzhJz6jNOQDMppsAypRE", "AIzaSyDLStYZbMJVXFtHLGyCu1PfwEZEgJIF_p8", "AIzaSyCRxOAbjZSIEi6iP8Tuxp_bLGQaFz3oyco", "AIzaSyBTmXn2XPOEpkLOX5rD0hY90FjtEw3g0_k", "AIzaSyCBp6CrIzqYdfo7rrlz5xjHZCsZU6fOweA"];
                             setConfirmDialog({ message: 'إضافة 25 مفتاح تجريبي لاستخراج الأسئلة؟', onConfirm: async () => {
                                await handleAddApiKeysBatch('extract', batch);
                             }});
                          }} className="bg-blue-600 hover:bg-blue-700 text-white px-3 py-2 rounded-xl text-xs font-bold shadow-md transition-colors whitespace-nowrap hidden md:block">إضافة تجارب +</button>
                      </div>
                      <div className="space-y-3">
                          {extractKeys.length === 0 && <p className="text-gray-400 text-sm font-bold text-center py-4">لا توجد مفاتيح مسجلة. سيتم استخدام المفتاح الأساسي.</p>}
                          {extractKeys.map((k, idx) => (
                              <div key={idx} className="flex justify-between items-center bg-gray-50 border border-gray-100 p-3 rounded-xl">
                                  <div className="flex flex-col gap-1">
                                      <span className="font-mono text-xs text-gray-600 truncate max-w-[200px]" dir="ltr">{k.substring(0, 10)}...{k.substring(k.length - 4)}</span>
                                      <span className="text-[10px] font-bold text-[#D4AF37]">الاستخدام: {extractKeysUsage[k] || 0} مرة</span>
                                  </div>
                                  <button onClick={() => handleRemoveApiKey('extract', k)} className="text-red-500 hover:text-red-700 bg-red-50 p-1.5 rounded-lg"><Trash size={14}/></button>
                              </div>
                          ))}
                      </div>
                   </div>

                   {/* Chat Keys */}
                   <div className="bg-white rounded-2xl border border-gray-200 shadow-sm p-6">
                      <h3 className="text-lg font-bold text-gray-800 mb-4 border-b border-gray-100 pb-3 flex items-center gap-2"><FileQuestion size={20} className="text-[#D4AF37]"/> مفاتيح شات الطلاب و تعرف تذاكر ايه</h3>
                      <div className="flex gap-2 mb-6">
                          <input 
                              value={newChatKey}
                              onChange={(e) => setNewChatKey(e.target.value)}
                              placeholder="أدخل مفتاح Gemini هنا..."
                              className="flex-1 bg-[#FAF9F6] border border-gray-200 rounded-xl px-4 py-2 text-sm outline-none focus:border-[#D4AF37] text-left"
                              dir="ltr"
                          />
                          <button onClick={() => handleAddApiKey('chat', newChatKey)} className="bg-[#1A1A1A] hover:bg-black text-white px-4 rounded-xl text-sm font-bold shadow-md">+</button>
                          <button onClick={async () => {
                             const batch = ["AIzaSyByAI-G5-YMXTxWtKl95Hb4vVgWnuzaoDI", "AIzaSyDTkoLORzrCO4cTafc7QGlrtGpJ9GoOEJ4", "AIzaSyCo_6_eLCNz2OPiBx17TZpdoJJUd4mlDLU", "AIzaSyDRwlWRVuUCvj5lAadN_cqux_zN-WCg_ZU", "AIzaSyDibCDZ2q95gTP3g2hbhEYDYTmLafhQ9z0", "AIzaSyA32uQYMnHnTQiZLvsUcZ-cHIlidpco5eQ", "AIzaSyCtFeYF9CCNcZ_Exf6JhE5-arMEEAf20vw", "AIzaSyBX3Yk7kSIpdFpsDc7DTFm1oPqa0fVT1Mg", "AIzaSyB9yPQUC_HubFxTyuHKjIF9dhKClj6wox4", "AIzaSyBjlrlw89-hIdegaPfrKykZeWp_7NjOeoI", "AIzaSyDZu5Yz3cn5CTDDTalbTdwIZrlsi4GcL1Y", "AIzaSyDzrh8XieUV_pUFBu0fdovFYAUL_r1NDp8", "AIzaSyAEhAQpr5Pf3YJ8F--NIyCeczjs3WxAXKo", "AIzaSyDMieLans2dIyqIL7WOLC9B-Kt-GS5x0-c", "AIzaSyDlpGJe1KPVtj8u6-bb33gzZbYNWlgspKI", "AIzaSyDNEEzT1bYMQWIo2ZwkBn5MVJg_6LpZwaY", "AIzaSyAe6zhamy6IPPkmGm7Ajhs9Ie4_PY1tlRI", "AIzaSyD1CHSQs6vMa0B-sJUXzDoaqqOzwlXvMRI", "AIzaSyB0MbzM3xxEvwjVPyivjIxl6_cx2BwZP7c", "AIzaSyC7YoZ2SKlVv9gOMoIH4QbeQeKsJ-k5ors", "AIzaSyAlRzN5fhGmZWACzhJz6jNOQDMppsAypRE", "AIzaSyDLStYZbMJVXFtHLGyCu1PfwEZEgJIF_p8", "AIzaSyCRxOAbjZSIEi6iP8Tuxp_bLGQaFz3oyco", "AIzaSyBTmXn2XPOEpkLOX5rD0hY90FjtEw3g0_k", "AIzaSyCBp6CrIzqYdfo7rrlz5xjHZCsZU6fOweA"];
                             setConfirmDialog({ message: 'إضافة 25 مفتاح تجريبي للدردشة التفاعلية؟', onConfirm: async () => {
                                await handleAddApiKeysBatch('chat', batch);
                             }});
                          }} className="bg-green-600 hover:bg-green-700 text-white px-3 py-2 rounded-xl text-xs font-bold shadow-md transition-colors whitespace-nowrap hidden md:block">إضافة تجارب +</button>
                      </div>
                      <div className="space-y-3">
                          {chatKeys.length === 0 && <p className="text-gray-400 text-sm font-bold text-center py-4">لا توجد مفاتيح مسجلة. سيتم استخدام المفتاح الأساسي.</p>}
                          {chatKeys.map((k, idx) => (
                              <div key={idx} className="flex justify-between items-center bg-gray-50 border border-gray-100 p-3 rounded-xl">
                                  <div className="flex flex-col gap-1">
                                      <span className="font-mono text-xs text-gray-600 truncate max-w-[200px]" dir="ltr">{k.substring(0, 10)}...{k.substring(k.length - 4)}</span>
                                      <span className="text-[10px] font-bold text-[#D4AF37]">الاستخدام: {chatKeysUsage[k] || 0} مرة</span>
                                  </div>
                                  <button onClick={() => handleRemoveApiKey('chat', k)} className="text-red-500 hover:text-red-700 bg-red-50 p-1.5 rounded-lg"><Trash size={14}/></button>
                              </div>
                          ))}
                      </div>
                   </div>
                </div>
              </div>
          )}

          {/* SUPPORT CHATS TAB */}
          {!loading && activeTab === 'support_chats' && (
              <div className="space-y-6">
                 <h2 className="text-2xl font-bold border-b-2 border-[#D4AF37] pb-2 inline-flex items-center gap-2"><Headset className="text-[#D4AF37]" size={24}/> تذاكر الدعم الفني والمحادثات المباشرة</h2>
                 
                 <div className="flex gap-6 h-[600px]">
                    <div className="w-1/3 bg-white border border-gray-200 rounded-2xl shadow-sm flex flex-col overflow-hidden">
                       <h3 className="bg-gray-50 border-b border-gray-200 p-4 font-bold text-gray-800 text-sm">المحادثات المفتوحة (حسب الجهاز)</h3>
                       <div className="flex-1 overflow-y-auto p-2 space-y-2">
                           {Array.from(new Set(supportChats.map(c => c.deviceId))).map(devId => {
                               const chatMessages = supportChats.filter(c => c.deviceId === devId);
                               const lastMsg = chatMessages[chatMessages.length - 1];
                               return (
                                   <div 
                                      key={devId} 
                                      onClick={() => setSelectedChatId(devId)}
                                      className={`p-3 rounded-xl border ${selectedChatId === devId ? 'bg-blue-50 border-blue-200' : 'bg-white border-gray-100 hover:bg-gray-50'} cursor-pointer transition-colors`}
                                   >
                                      <h4 className="font-bold text-xs truncate max-w-full text-gray-900">{getStudentDisplayName(devId, lastMsg?.studentName)}</h4>
                                      <p className="text-[10px] text-gray-500 truncate mt-1">{lastMsg?.message}</p>
                                   </div>
                               );
                           })}
                       </div>
                    </div>
                    <div className="flex-1 bg-white border border-gray-200 rounded-2xl shadow-sm flex flex-col overflow-hidden">
                       {selectedChatId ? (
                           <>
                             <div className="bg-gray-900 p-4 text-white flex items-center justify-between">
                                 <div>
                                     <h3 className="font-bold text-sm">محادثة مع جهاز: {selectedChatId}</h3>
                                     {supportChats.filter(c => c.deviceId === selectedChatId).find(c => c.bankName)?.bankName && (
                                         <p className="text-[10px] text-gray-300 mt-1 font-bold">
                                             القسم: {supportChats.filter(c => c.deviceId === selectedChatId).find(c => c.bankName)?.bankName}
                                         </p>
                                     )}
                                 </div>
                                 <div className="flex gap-2">
                                     <button 
                                         onClick={async () => {
                                             const studentName = supportChats.filter(c => c.deviceId === selectedChatId).slice(-1)[0]?.studentName || '';
                                             const allowName = window.prompt('أدخل اسم الطالب للسماح له بالدخول (اكتب الاسم بالكامل):', studentName);
                                             if (allowName) {
                                                 try {
                                                     await addDoc(collection(db, 'allowed_students'), { fullName: allowName, name: allowName, ips: [] });
                                                     alert(`تمت إضافة الاسم "${allowName}" لقائمة السماح! يمكنه تسجيل الدخول الآن.`);
                                                 } catch (e) {
                                                     console.error(e);
                                                     alert("حدث خطأ أثناء الإضافة.");
                                                 }
                                             }
                                         }} 
                                         className="bg-emerald-600 hover:bg-emerald-700 text-white px-3 py-1.5 rounded-lg text-xs font-bold transition-colors flex items-center gap-1 shadow-sm"
                                         title="السماح للطالب بالدخول وإضافته للقائمة"
                                     >
                                         <UserCheck size={14} /> إضافة للقائمة
                                     </button>
                                     <button 
                                         onClick={() => {
                                             setConfirmDialog({ message: 'هل أنت متأكد من إنهاء هذه المحادثة ومسحها بالكامل؟', onConfirm: async () => {
                                                 try {
                                                     const chatsToDelete = supportChats.filter(c => c.deviceId === selectedChatId);
                                                     for (const chat of chatsToDelete) {
                                                         await deleteDoc(doc(db, 'support_chats', chat.id));
                                                     }
                                                     setSelectedChatId(null);
                                                     alert('تم إنهاء المحادثة بنجاح.');
                                                 } catch(e) {
                                                     console.error(e);
                                                     alert('حدث خطأ');
                                                 }
                                             }});
                                         }}
                                         className="bg-gray-800 hover:bg-red-800 text-white px-3 py-1.5 rounded-lg text-xs font-bold transition-colors flex items-center gap-1 shadow-sm"
                                     >
                                         <Check size={14} /> إنهاء ومسح
                                     </button>
                                 </div>
                             </div>
                             <div className="flex-1 bg-[#F8F9FA] p-4 overflow-y-auto flex flex-col gap-3">
                                 {supportChats.filter(c => c.deviceId === selectedChatId).map(msg => (
                                     <div key={msg.id} className={`flex ${msg.sender === 'admin' ? 'justify-start' : 'justify-end'}`}>
                                         <div className={`max-w-[70%] p-3 rounded-2xl text-sm ${msg.sender === 'admin' ? 'bg-[#D4AF37] text-white rounded-br-sm' : 'bg-white text-gray-800 border border-gray-200 rounded-bl-sm'}`}>
                                            <p className="leading-relaxed">{msg.message}</p>
                                         </div>
                                     </div>
                                 ))}
                             </div>
                             <div className="p-3 bg-white border-t border-gray-100 flex gap-2 w-full">
                                 <input 
                                     value={adminReply}
                                     onChange={e => setAdminReply(e.target.value)}
                                     placeholder="اكتب ردك هنا..."
                                     className="flex-1 bg-gray-50 border border-gray-200 rounded-xl px-4 py-3 text-sm focus:border-[#D4AF37] outline-none"
                                 />
                                 <button 
                                     onClick={async () => {
                                         if (!adminReply.trim()) return;
                                         await addDoc(collection(db, 'support_chats'), {
                                             deviceId: selectedChatId,
                                             message: adminReply,
                                             sender: 'admin',
                                             createdAt: serverTimestamp()
                                         });
                                         setAdminReply('');
                                     }}
                                     className="bg-[#1A1A1A] hover:bg-black text-white w-12 flex items-center justify-center rounded-xl transition-colors"
                                 >
                                     <Send size={18} />
                                 </button>
                             </div>
                           </>
                       ) : (
                           <div className="flex flex-col items-center justify-center h-full text-gray-400">
                               <Headset size={48} className="mb-4 opacity-50" />
                               <p className="font-bold">اختر محادثة من القائمة لعرضها والرد عليها.</p>
                           </div>
                       )}
                    </div>
                 </div>
              </div>
          )}

          {/* Custom Confirm Dialog Modal (fix delete button not working) */}
          <AnimatePresence>
            {confirmDialog && (
              <motion.div 
                initial={{ opacity: 0 }}
                animate={{ opacity: 1 }}
                exit={{ opacity: 0 }}
                className="fixed inset-0 z-50 flex items-center justify-center p-4 bg-black/40 backdrop-blur-sm"
                dir="rtl"
              >
                <motion.div 
                  initial={{ scale: 0.95, y: 10 }}
                  animate={{ scale: 1, y: 0 }}
                  exit={{ scale: 0.95, y: 10 }}
                  className="bg-white rounded-2xl border border-gray-200 shadow-2xl max-w-md w-full overflow-hidden p-6 text-right"
                >
                  <div className="flex items-start gap-4">
                    <div className="bg-red-50 text-red-500 p-3 rounded-full shrink-0">
                      <AlertTriangle size={24} />
                    </div>
                    <div>
                      <h3 className="text-lg font-bold text-gray-900 mb-2">تأكيد الإجراء</h3>
                      <p className="text-gray-600 text-sm leading-relaxed mb-6 font-bold">{confirmDialog.message}</p>
                    </div>
                  </div>
                  <div className="flex justify-end gap-3 border-t border-gray-100 pt-4">
                    <button 
                      onClick={() => setConfirmDialog(null)}
                      className="px-4 py-2 text-sm font-bold text-gray-500 hover:bg-gray-50 border border-gray-200 rounded-xl transition-all"
                    >
                      إلغاء الإجراء
                    </button>
                    <button 
                      onClick={() => {
                        confirmDialog.onConfirm();
                        setConfirmDialog(null);
                      }}
                      className="px-5 py-2 text-sm font-bold bg-red-600 hover:bg-red-700 text-white rounded-xl shadow-md cursor-pointer transition-all active:scale-95"
                    >
                      تأكيد
                    </button>
                  </div>
                </motion.div>
              </motion.div>
            )}
          </AnimatePresence>

          {/* Custom Prompt Dialog Modal */}
          <AnimatePresence>
            {promptDialog && (
              <PromptDialogLocal 
                dialog={promptDialog} 
                onClose={() => setPromptDialog(null)} 
              />
            )}
          </AnimatePresence>

          {/* Bank Configuration Modal */}
          <AnimatePresence>
            {selectedBankToConfigure && (
              <motion.div 
                initial={{ opacity: 0 }}
                animate={{ opacity: 1 }}
                exit={{ opacity: 0 }}
                className="fixed inset-0 z-50 flex items-center justify-center p-4 bg-black/40 backdrop-blur-sm overflow-y-auto"
                dir="rtl"
              >
                <motion.div 
                  initial={{ scale: 0.95, y: 15 }}
                  animate={{ scale: 1, y: 0 }}
                  exit={{ scale: 0.95, y: 15 }}
                  className="bg-white rounded-3xl border border-gray-200 shadow-2xl max-w-2xl w-full p-6 text-right space-y-6 my-8"
                >
                  <div className="flex justify-between items-center border-b border-gray-100 pb-3">
                     <h3 className="text-xl font-bold text-gray-900 flex items-center gap-2">
                        <Settings className="text-[#D4AF37]" size={22} />
                        إعدادات المجلد (البنك): <span className="text-[#D4AF37]">{selectedBankToConfigure.name}</span>
                     </h3>
                     <button onClick={() => setSelectedBankToConfigure(null)} className="text-gray-400 hover:text-gray-600 font-bold text-lg">&times;</button>
                  </div>

                  <div className="space-y-4">
                     {/* Bank Name input */}
                     <div>
                        <label className="block text-xs font-bold text-gray-400 mb-2">اسم المجلد (البنك العلمي)</label>
                        <input 
                          type="text"
                          value={selectedBankToConfigure.name}
                          onChange={(e) => setSelectedBankToConfigure({ ...selectedBankToConfigure, name: e.target.value })}
                          className="w-full bg-[#FAF9F6] border border-gray-200 rounded-xl px-4 py-3 text-sm focus:border-[#D4AF37] outline-none font-bold text-gray-800"
                        />
                     </div>

                     {/* Cover image upload */}
                     <div>
                        <label className="block text-xs font-bold text-gray-400 mb-2">غلاف المجلد (صورة تعبيرية للبنك تظهر للطلاب)</label>
                        <div className="flex items-center gap-4 bg-[#FAF9F6] p-4 rounded-xl border border-gray-100">
                           {selectedBankToConfigure.imageUrl ? (
                              <div className="w-16 h-16 rounded-xl overflow-hidden border border-gray-200 relative group">
                                 <img src={selectedBankToConfigure.imageUrl} alt="Cover Preview" className="w-full h-full object-cover" />
                                 <button 
                                   onClick={() => setSelectedBankToConfigure({ ...selectedBankToConfigure, imageUrl: "" })}
                                   className="absolute inset-0 bg-black/60 text-white flex items-center justify-center opacity-0 group-hover:opacity-100 transition-opacity text-xs font-bold"
                                 >
                                    حذف الصورة
                                 </button>
                              </div>
                           ) : (
                              <div className="w-16 h-16 rounded-xl bg-gray-100 flex items-center justify-center border-2 border-dashed border-gray-200 text-gray-400">
                                 لا صورة
                              </div>
                           )}
                           <div className="flex-grow">
                              <label className="cursor-pointer bg-white border border-gray-200 shadow-sm rounded-xl px-4 py-2 text-xs font-bold text-gray-700 hover:bg-gray-50 inline-flex items-center gap-2">
                                 <Upload size={14} /> إضافة أو تغيير غلاف البنك
                                 <input 
                                   type="file" 
                                   accept="image/*" 
                                   className="hidden" 
                                   onChange={(e) => {
                                      const file = e.target.files?.[0];
                                      if (file) {
                                         const reader = new FileReader();
                                         reader.onloadend = () => {
                                            setSelectedBankToConfigure({ ...selectedBankToConfigure, imageUrl: reader.result });
                                         };
                                         reader.readAsDataURL(file);
                                      }
                                   }} 
                                 />
                              </label>
                              <p className="text-[10px] text-gray-400 mt-1">يمكنك إضافة غلاف صورة للقسم العلمي ليظهر في صفحة الطالب الرئيسية قبل الدخول للامتحان.</p>
                           </div>
                        </div>
                     </div>

                     {/* Reference subject book upload */}
                     <div>
                        <div className="flex justify-between items-center mb-2">
                           <label className="block text-xs font-bold text-gray-400">الكتاب المرجعي للمادة العلمي (المحتوى لتغذية البوت AI) 📖</label>
                           <label className="cursor-pointer text-xs font-bold text-blue-600 hover:text-blue-800 flex items-center gap-1">
                              <CloudUpload size={14} /> أو ارفع ملف نصي أو PDF (.txt, .md, .pdf)
                                <input 
                                type="file" 
                                accept=".txt,.md,.pdf,.docx" 
                                className="hidden" 
                                onChange={async (e) => {
                                   const file = e.target.files?.[0];
                                   if (!file) return;
                                   
                                   if (file.name.endsWith('.pdf')) {
                                      try {
                                         toast.loading("جاري قراءة ملف الـ PDF... (هذا قد يستغرق بعض الوقت للكتب الكبيرة)", { id: "pdf-load" });
                                         const arrayBuffer = await file.arrayBuffer();
                                         const pdf = await pdfjsLib.getDocument({ data: arrayBuffer }).promise;
                                         let fullText = '';
                                         for (let i = 1; i <= pdf.numPages; i++) {
                                             const page = await pdf.getPage(i);
                                             const textContent = await page.getTextContent();
                                             const pageText = textContent.items.map((item: any) => item.str).join(' ');
                                             fullText += pageText + '\n';
                                         }
                                         setSelectedBankToConfigure({ ...selectedBankToConfigure, referenceBook: fullText });
                                         toast.success("تم قراءة ملف الـ PDF بنجاح!", { id: "pdf-load" });
                                      } catch (err) {
                                         console.error(err);
                                         toast.error("فشل استخراج النص من الـ PDF.", { id: "pdf-load" });
                                      }
                                   } else if (file.name.endsWith('.docx')) {
                                      try {
                                         toast.loading("جاري قراءة ملف Word...", { id: "word-load" });
                                         const arrayBuffer = await file.arrayBuffer();
                                         const result = await mammoth.extractRawText({ arrayBuffer });
                                         setSelectedBankToConfigure({ ...selectedBankToConfigure, referenceBook: result.value });
                                         toast.success("تم قراءة ملف Word بنجاح!", { id: "word-load" });
                                      } catch (err) {
                                         console.error(err);
                                         toast.error("فشل استخراج النص.", { id: "word-load" });
                                      }
                                   } else {
                                      const reader = new FileReader();
                                      reader.onload = (evt) => {
                                         setSelectedBankToConfigure({ ...selectedBankToConfigure, referenceBook: evt.target?.result as string });
                                      };
                                      reader.readAsText(file);
                                   }
                                }} 
                              />
                           </label>
                        </div>
                        <textarea 
                          value={selectedBankToConfigure.referenceBook || ""}
                          onChange={(e) => setSelectedBankToConfigure({ ...selectedBankToConfigure, referenceBook: e.target.value })}
                          placeholder="الصق فصول الكتاب الدراسي، أو المحاضرات العلمية هنا بالكامل... سيقوم الذكاء الاصطناعي بحفظها كقاعدة المعرفة الوحيدة له في نقاش أسئلة هذا المجلد مع الطلاب!"
                          className="w-full bg-[#FAF9F6] border border-gray-200 rounded-xl px-4 py-3 text-xs focus:border-[#D4AF37] outline-none h-44 font-medium text-gray-700 leading-relaxed resize-none"
                        />
                        <p className="text-[10px] text-[#D4AF37] font-bold mt-1">💡 فكرة عظيمة: عندما يفتح الطلاب نقاش أسئلة هذا البنك، لن يتحدث البوت إلا استناداً لفقرات هذا الكتاب التي ترسلها إليه.</p>
                     </div>

                     {/* Bank Warnings & Expiry */}
                     <div className="grid grid-cols-1 gap-4 mb-4">
                        <div>
                           <label className="block text-xs font-bold text-gray-500 mb-1">الرسالة التحذيرية قبل بدء الاختبار (اختياري)</label>
                           <textarea 
                             value={selectedBankToConfigure.warningMessage || ""}
                             onChange={(e) => setSelectedBankToConfigure({ ...selectedBankToConfigure, warningMessage: e.target.value })}
                             placeholder="مثال: هذا الاختبار تجريبي ولن يتم تسجيل نتيجتك..."
                             className="w-full bg-[#FAF9F6] border border-gray-200 rounded-xl px-4 py-2 text-sm focus:border-[#D4AF37] outline-none font-bold text-gray-800"
                             rows={2}
                           />
                        </div>
                        <div>
                           <label className="block text-xs font-bold text-gray-500 mb-1">وقت وتاريخ الحذف التلقائي للبنك (اختياري)</label>
                           <input 
                             type="datetime-local" 
                             value={selectedBankToConfigure.autoDeleteAt ? new Date(selectedBankToConfigure.autoDeleteAt - new Date().getTimezoneOffset() * 60000).toISOString().slice(0,16) : ""}
                             onChange={(e) => setSelectedBankToConfigure({ ...selectedBankToConfigure, autoDeleteAt: e.target.value ? new Date(e.target.value).getTime() : null })}
                             className="w-full bg-[#FAF9F6] border border-gray-200 rounded-xl px-4 py-2 text-sm focus:border-[#D4AF37] outline-none font-bold text-gray-800"
                           />
                           <p className="text-[9px] text-gray-400 mt-1">يُخفى تلقائياً عن الطلاب بعد هذا التاريخ</p>
                        </div>
                     </div>

                     {/* Bank Permissions and Logic */}
                     <div className="grid grid-cols-2 gap-4">
                        <div>
                           <label className="block text-xs font-bold text-gray-400 mb-2">وقت البنك (بالدقائق)</label>
                           <input 
                             type="number" 
                             min={0}
                             value={selectedBankToConfigure.timeLimit || 0}
                             onChange={(e) => setSelectedBankToConfigure({ ...selectedBankToConfigure, timeLimit: parseInt(e.target.value) || 0 })}
                             className="w-full bg-[#FAF9F6] border border-gray-200 rounded-xl px-4 py-2 text-sm focus:border-[#D4AF37] outline-none font-bold text-gray-800"
                           />
                           <p className="text-[9px] text-gray-400 mt-1">اتركها 0 للامتحان المفتوح المفتوح</p>
                        </div>
                        <div className="flex flex-col justify-center">
                           <label className="flex items-center gap-2 cursor-pointer mt-5">
                              <input 
                                type="checkbox" 
                                checked={selectedBankToConfigure.isPublic !== false}
                                onChange={(e) => setSelectedBankToConfigure({ ...selectedBankToConfigure, isPublic: e.target.checked })}
                                className="w-4 h-4 accent-[#D4AF37]"
                              />
                              <span className="text-sm font-bold text-gray-700">بنك عام (مفتوح للجميع)</span>
                           </label>
                           <p className="text-[9px] text-gray-400">إذا تم إلغاء تحديد هذا الخيار، سيتم تحديد إمكانية الدخول بالأسماء المسموحة فقط.</p>
                        </div>
                     </div>

                     {selectedBankToConfigure.isPublic === false && (
                        <div>
                           <label className="block text-xs font-bold text-gray-400 mb-2">الأسماء المسموح لها بالدخول (كل اسم في سطر مستقل)</label>
                           <textarea 
                             value={selectedBankToConfigure.allowedNames || ""}
                             onChange={(e) => setSelectedBankToConfigure({ ...selectedBankToConfigure, allowedNames: e.target.value })}
                             placeholder="محمود أحمد&#10;بسمة علاء&#10;خالد جمال..."
                             className="w-full bg-[#FAF9F6] border border-gray-200 rounded-xl px-4 py-3 text-xs focus:border-[#D4AF37] outline-none h-32 font-medium text-gray-700 leading-relaxed resize-none"
                           />
                        </div>
                     )}

                     <div className="bg-[#FAF9F6] p-3 rounded-xl border border-[#D4AF37]/30 flex justify-between items-center">
                         <div className="flex items-center gap-2 text-xs font-bold text-gray-600 truncate">
                             <span className="text-gray-400 truncate max-w-[200px]">{window.location.origin}/login?bank={selectedBankToConfigure.id}</span>
                         </div>
                         <button 
                             onClick={() => {
                                 navigator.clipboard.writeText(`${window.location.origin}/login?bank=${selectedBankToConfigure.id}`);
                                 alert('تم نسخ الرابط بنجاح!');
                             }}
                             className="text-xs bg-white border border-[#D4AF37] text-[#D4AF37] px-3 py-1.5 rounded-lg hover:bg-[#D4AF37] hover:text-white transition-colors"
                         >
                             نسخ الرابط
                         </button>
                     </div>
                  </div>

                  <div className="flex justify-between items-center border-t border-gray-100 pt-4 gap-3">
                     <button 
                       onClick={() => {
                          deleteBank(selectedBankToConfigure.id, selectedBankToConfigure.name);
                          setSelectedBankToConfigure(null);
                       }}
                       className="px-4 py-2.5 text-xs font-bold text-red-650 hover:bg-red-50 rounded-xl transition-all border border-red-200 flex items-center gap-1"
                     >
                        <Trash size={14} /> حذف البنك نهائياً
                     </button>

                     <div className="flex gap-3">
                        <button 
                          onClick={() => setSelectedBankToConfigure(null)}
                          className="px-4 py-2.5 text-xs font-bold text-gray-500 hover:bg-gray-50 border border-gray-200 rounded-xl transition-all"
                        >
                           إلغاء الإجراء
                        </button>
                        <button 
                          onClick={async () => {
                             if (!selectedBankToConfigure.name.trim()) return alert("يرجى كتابة اسم البنك.");
                             try {
                                const bankRef = doc(db, 'banks', selectedBankToConfigure.id);
                                const updatedFields = {
                                   name: selectedBankToConfigure.name,
                                   imageUrl: selectedBankToConfigure.imageUrl || "",
                                   referenceBook: selectedBankToConfigure.referenceBook || "",
                                   isPublic: selectedBankToConfigure.isPublic !== false,
                                   timeLimit: selectedBankToConfigure.timeLimit || 0,
                                   allowedNames: selectedBankToConfigure.allowedNames || "",
                                   warningMessage: selectedBankToConfigure.warningMessage || "",
                                   autoDeleteAt: selectedBankToConfigure.autoDeleteAt || null
                                };
                                await updateDoc(bankRef, updatedFields);
                                setBanks(prev => prev.map(b => b.id === selectedBankToConfigure.id ? { ...b, ...updatedFields } : b));
                                setSelectedBankToConfigure(null);
                                alert("تم حفظ إعدادات البنك والكتاب المنهجي بنجاح! ✨");
                             } catch(e: any) {
                                alert("فشل الحفظ: " + e.message);
                             }
                          }}
                          className="bg-[#D4AF37] hover:bg-[#C5A059] text-white font-bold py-2.5 px-5 rounded-xl transition-all text-xs shadow-md"
                        >
                           حفظ التغييرات ✅
                        </button>
                     </div>
                  </div>
                </motion.div>
              </motion.div>
            )}
          </AnimatePresence>
        </div>
      </main>    
    </div>
  );
}

function PromptDialogLocal({ dialog, onClose }: { dialog: { message: string, defaultValue: string, onConfirm: (val: string) => void }, onClose: () => void }) {
  const [val, setVal] = useState(dialog.defaultValue);
  return (
    <motion.div 
      initial={{ opacity: 0 }}
      animate={{ opacity: 1 }}
      exit={{ opacity: 0 }}
      className="fixed inset-0 z-50 flex items-center justify-center p-4 bg-black/40 backdrop-blur-sm"
      dir="rtl"
    >
      <motion.div 
        initial={{ scale: 0.95, y: 10 }}
        animate={{ scale: 1, y: 0 }}
        exit={{ scale: 0.95, y: 10 }}
        className="bg-white rounded-2xl border border-gray-200 shadow-2xl max-w-md w-full overflow-hidden p-6 text-right"
      >
        <h3 className="text-lg font-bold text-gray-900 mb-3">{dialog.message}</h3>
        <input 
          autoFocus
          value={val}
          onChange={(e) => setVal(e.target.value)}
          className="w-full bg-[#FAF9F6] border border-gray-200 rounded-xl px-4 py-3 text-sm focus:border-[#D4AF37] outline-none mb-6 text-right font-bold text-gray-800"
          placeholder="اكتب القيمة هنا..."
        />
        <div className="flex justify-end gap-3 border-t border-gray-100 pt-4">
          <button 
            onClick={onClose}
            className="px-4 py-2 text-sm font-bold text-gray-500 hover:bg-gray-50 border border-gray-200 rounded-xl transition-all"
          >
            إلغاء الإجراء
          </button>
          <button 
            onClick={() => {
              dialog.onConfirm(val);
              onClose();
            }}
            className="px-5 py-2 text-sm font-bold bg-[#1A1A1A] hover:bg-black text-white rounded-xl shadow-md cursor-pointer transition-all active:scale-95"
          >
            حفظ
          </button>
        </div>
      </motion.div>
    </motion.div>
  );
}

function SidebarBtn({ active, icon, text, onClick }: any) {
  return (
    <button 
      onClick={onClick}
      className={`w-full flex items-center gap-3 px-4 py-3.5 rounded-xl text-[13px] font-bold transition-all ${active ? 'bg-white text-[#D4AF37] border border-gray-200 shadow-sm' : 'text-gray-500 hover:bg-white/60 hover:text-gray-900 border border-transparent'}`}
    >
      {icon} <span className="tracking-wide">{text}</span>
    </button>
  );
}

