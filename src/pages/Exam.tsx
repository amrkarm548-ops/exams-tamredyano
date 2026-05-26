import { useState, useEffect, useRef } from 'react';
import { motion, AnimatePresence } from 'motion/react';
import { useNavigate } from 'react-router-dom';
import { Bookmark, AlertTriangle, Moon, Sun, X, Send, Copy, Maximize2, FolderOpen, Settings, ChevronRight, ChevronLeft, LogOut, Bot, LayoutList, Trash, Paperclip, MessageCircle, ShieldAlert, Headset, RefreshCw } from 'lucide-react';
import { cn } from '@/src/lib/utils';
import ReactMarkdown from 'react-markdown';
import { db, handleFirestoreError, OperationType } from '@/src/lib/firebase';
import { doc, getDoc, setDoc, addDoc, increment, collection, serverTimestamp, getDocs, query, where, orderBy, onSnapshot } from 'firebase/firestore';
import { useAuth } from '../context/AuthContext';

// Fisher-Yates shuffle
function shuffle(array: any[]) {
  let currentIndex = array.length,  randomIndex;
  while (currentIndex > 0) {
    randomIndex = Math.floor(Math.random() * currentIndex);
    currentIndex--;
    [array[currentIndex], array[randomIndex]] = [
      array[randomIndex], array[currentIndex]];
  }
  return array;
}

const BAD_WORDS = ["شتيمة", "حمار", "كلب", "غبي", "stupid", "idiot", "shit", "fuck", "bitch"];

export default function Exam() {
  const navigate = useNavigate();
  const { studentData, loginAdmin, loginStudent, logout } = useAuth();
  const [questions, setQuestions] = useState<any[]>([]);
  const [banks, setBanks] = useState<any[]>([]);
  const [selectedBankId, setSelectedBankId] = useState<string | null>(null);
  const [loadingBanks, setLoadingBanks] = useState(true);
  
  const [examMode, setExamMode] = useState<'immediate' | 'deferred'>('immediate');
  const [showModeSelect, setShowModeSelect] = useState<string | null>(null);

  const [currentIndex, setCurrentIndex] = useState(0);
  const [selectedAnswers, setSelectedAnswers] = useState<Record<string, number>>({});
  const [bookmarked, setBookmarked] = useState<Record<string, boolean>>({});
  const [studentId, setStudentId] = useState<string>('');
  
  // Post-Exam State
  const [isFinished, setIsFinished] = useState(false);
  const [timeRemaining, setTimeRemaining] = useState<number | null>(null);
  const [startTime, setStartTime] = useState(Date.now());
  const [timeTaken, setTimeTaken] = useState(0);
  const [studyGuide, setStudyGuide] = useState<string | null>(null);
  const [generatingGuide, setGeneratingGuide] = useState(false);
  const [rating, setRating] = useState(0);
  const [feedback, setFeedback] = useState('');
  const [feedbackSubmitted, setFeedbackSubmitted] = useState(false);

  useEffect(() => {
    if (questions.length > 0 && !isFinished && timeRemaining !== null && timeRemaining > 0) {
      const timer = setInterval(() => {
        setTimeRemaining(prev => {
          if (prev && prev <= 1) {
            clearInterval(timer);
            setIsFinished(true);
            setTimeTaken(Math.round((Date.now() - startTime) / 60000));
            return 0;
          }
          return prev ? prev - 1 : 0;
        });
      }, 1000);
      return () => clearInterval(timer);
    }
  }, [questions.length, isFinished, timeRemaining]);

  // AI Chat State
  const [isChatOpen, setIsChatOpen] = useState(false);
  const [chatMessages, setChatMessages] = useState<{role: string, content: string, hasAttachment?: boolean}[]>([]);
  const [chatInput, setChatInput] = useState('');
  const [isChatLoading, setIsChatLoading] = useState(false);
  const [chatFile, setChatFile] = useState<{file: File, base64: string, mimeType: string} | null>(null);
  const chatEndRef = useRef<HTMLDivElement>(null);

  // Support Chat State
  const [showSupportChat, setShowSupportChat] = useState(false);
  const [supportMessage, setSupportMessage] = useState('');
  const [supportChatMessages, setSupportChatMessages] = useState<any[]>([]);
  const supportChatEndRef = useRef<HTMLDivElement>(null);

  // Lightbox State
  const [lightboxImage, setLightboxImage] = useState<string | null>(null);

  const [isBannedState, setIsBannedState] = useState(false);

  // Settings State
  const [showSettings, setShowSettings] = useState(false);
  const [showReportModal, setShowReportModal] = useState(false);
  const [reportReason, setReportReason] = useState('');
  const [themeMode, setThemeMode] = useState<'light'|'sepia'>('light'); // no dark mode per instructions
  const [brightness, setBrightness] = useState(100);
  const [displayName, setDisplayName] = useState(studentData?.name || '');

  // Admin Upgrade State
  const [showAdminUpgrade, setShowAdminUpgrade] = useState(false);
  const [adminPassword, setAdminPassword] = useState('');

  const [globalSettings, setGlobalSettings] = useState<any>(null);

  useEffect(() => {
    const unsub = onSnapshot(doc(db, 'admin_system', 'global_settings'), (snap) => {
        if (snap.exists()) {
            setGlobalSettings(snap.data());
        }
    });
    return () => unsub();
  }, []);

  const handleAdminUpgrade = () => {
    if (adminPassword === "nursing admins 123") {
      let name = "Admin Student";
      if (studentData) {
        name = studentData.name;
      }
      loginAdmin(name);
      navigate('/admin-dashboard', { replace: true });
    } else {
      alert("كلمة المرور غير صحيحة");
    }
  };

  useEffect(() => {
    if(!studentData || !studentData.id) return;
    const updatePresence = async () => {
      try {
        const { doc, setDoc, serverTimestamp } = await import('firebase/firestore');
        await setDoc(doc(db, 'users', studentData.id), {
           lastActive: serverTimestamp(),
           isOnline: true
        }, { merge: true });
      } catch(e) {}
    };
    updatePresence();
    const interval = setInterval(updatePresence, 3 * 60 * 1000); // 3 minutes
    return () => clearInterval(interval);
  }, [studentData]);

  useEffect(() => {
    let unsubUser = () => {};
    let unsubGlobal = () => {};
    // Check Auth
    if (!studentData) {
      if (!window.location.search.includes('public')) {
        navigate('/login', { replace: true });
        return;
      }
    } else {
      setStudentId(studentData.id);
      
      // PERSISTENT ACCESS CHECK: Ensure student account is still in allowed_students collection and verify device binding
      const isBypassed = studentData.id.startsWith('dummy_');
      
      // Realtime listener on global_settings for Force Kick (Applies to EVERYONE)
      unsubGlobal = onSnapshot(doc(db, 'admin_system', 'global_settings'), (docSnap: any) => {
          if (docSnap.exists()) {
              const data = docSnap.data();
              const kickTimestamp = data.force_logout_timestamp;
              const studentLoginTime = localStorage.getItem('tamrediano_login_time');
              // If kick was triggered after the student logged in, kick them.
              if (kickTimestamp && studentLoginTime && kickTimestamp > Number(studentLoginTime)) {
                  logout();
                  navigate('/login', { replace: true });
                  alert("تم طرد جميع الطلاب من قبل الإدارة لتحديث النظام. الرجاء تسجيل الدخول مجدداً قريباً.");
              }
          }
      });

      if (!isBypassed && !studentData.id.startsWith('student_')) {
          try {
             // 1. One time check on allowed_students and strikes
             const verifyAccess = async () => {
                 const strikeSnap = await getDoc(doc(db, 'strikes', studentData.id));
                 if (strikeSnap.exists() && strikeSnap.data().banned) {
                    setIsBannedState(true);
                    return;
                 }
                 const allowedSnap = await getDoc(doc(db, 'allowed_students', studentData.id));
                 if (allowedSnap.exists()) {
                    const data = allowedSnap.data();
                    if (data.expiresAt) {
                        const expTime = data.expiresAt.toDate ? data.expiresAt.toDate().getTime() : data.expiresAt;
                        if (expTime < Date.now()) {
                            logout();
                            navigate('/login', { replace: true });
                            alert("تنبيــه: انتهت صلاحية حسابك.");
                            return;
                        }
                    }
                 } else {
                    logout();
                    navigate('/login', { replace: true });
                    alert("تنبيــه: تم إلغاء صلاحية هذا الاسم أو حذفه من قبل الإدارة.");
                    return;
                 }
             };
             verifyAccess();

             // 2. Realtime listener on Users collection for device override
             unsubUser = onSnapshot(doc(db, 'users', studentData.id), (docSnap: any) => {
                 if (docSnap.exists()) {
                     const data = docSnap.data();
                     // Check device mismatch
                     const localDeviceId = localStorage.getItem('tamrediano_device_id');
                     if (data.currentDeviceId && localDeviceId && data.currentDeviceId !== localDeviceId) {
                         logout();
                         navigate('/login', { replace: true });
                         alert("تم تسجيل الدخول من جهاز آخر. تم تسجيل الخروج من هذا الحساب.");
                         return;
                     }
                 }
             });
          } catch(e) {
             console.error("Access verification error:", e);
          }
      }
    }

    const loadBanksAndState = async () => {
      // Fallback timer just in case Firestore getDocs hangs
      const fallbackTimer = setTimeout(() => setLoadingBanks(false), 5000);
      let fetchedBanks: any[] = [];
      try {
        const banksSnap = await getDocs(collection(db, 'banks'));
        const now = Date.now();
        fetchedBanks = banksSnap.docs
            .map(d => ({ id: d.id, ...d.data() }))
            .filter((b: any) => !b.autoDeleteAt || b.autoDeleteAt > now);
        setBanks(fetchedBanks);
      } catch (err) {
        handleFirestoreError(err, OperationType.GET, 'banks');
      } finally {
        clearTimeout(fallbackTimer);
        setLoadingBanks(false);
      }

      const savedState = localStorage.getItem('tamrediano_exam_state');
      const urlParams = new URLSearchParams(window.location.search);
      const bankIdUrl = urlParams.get('bank');

      if (savedState) {
          const parsed = JSON.parse(savedState);
          // Check if restored bank still exists!
          const bankExists = fetchedBanks.find(b => b.id === parsed.bankId);
          let isAllowed = false;
          if (bankExists) {
              if (bankExists.isPublic !== false) {
                  isAllowed = true;
              } else if (bankExists.allowedNames) {
                  const normalize = (n: string) => n.trim().replace(/\s+/g, ' ');
                  const authName = normalize(studentData?.fullName || studentData?.name || '');
                  const names = bankExists.allowedNames.split('\n').map(normalize).filter((n: string) => n);
                  isAllowed = names.includes(authName);
              }
          }

          // If URL bank exists and is different from saved state bank, ignore saved state
          if (bankIdUrl && bankIdUrl !== parsed.bankId && fetchedBanks.find(b => b.id === bankIdUrl)) {
              localStorage.removeItem('tamrediano_exam_state');
              setShowModeSelect(bankIdUrl);
          } 
          else if (isAllowed && bankExists && parsed.bankId && parsed.questions && parsed.questions.length > 0) {
              setSelectedBankId(parsed.bankId);
              setQuestions(parsed.questions);
              setSelectedAnswers(parsed.selectedAnswers || {});
              setBookmarked(parsed.bookmarked || {});
              setCurrentIndex(parsed.currentIndex || 0);
              setTimeRemaining(parsed.timeRemaining ?? null);
              if (parsed.examMode) setExamMode(parsed.examMode);
          } else {
              // Clear invalid state
              localStorage.removeItem('tamrediano_exam_state');
              if (bankIdUrl && fetchedBanks.find(b => b.id === bankIdUrl)) {
                  setShowModeSelect(bankIdUrl);
              }
          }
      } else {
          if (bankIdUrl && fetchedBanks.find(b => b.id === bankIdUrl)) {
              setShowModeSelect(bankIdUrl);
          }
      }
    };

    loadBanksAndState();

    return () => {
        unsubUser();
        unsubGlobal();
    };
  }, [navigate]);

  useEffect(() => {
    if (questions.length > 0 && selectedBankId !== null) { // !== null check
      localStorage.setItem('tamrediano_exam_state', JSON.stringify({
        bankId: selectedBankId,
        questions,
        selectedAnswers,
        bookmarked,
        currentIndex,
        examMode,
        timeRemaining
      }));
    }
  }, [questions, selectedAnswers, bookmarked, currentIndex, selectedBankId, examMode, timeRemaining]);
  
  useEffect(() => {
    if (supportChatEndRef.current) {
        supportChatEndRef.current.scrollIntoView({ behavior: 'smooth' });
    }
  }, [supportChatMessages]);

  useEffect(() => {
     const deviceId = studentData?.id || localStorage.getItem('deviceId');
     if (!deviceId || !showSupportChat) return;
     const q = query(
         collection(db, 'support_chats'),
         where('deviceId', '==', deviceId),
         orderBy('createdAt', 'asc')
     );
     const unsubscribe = onSnapshot(q, (snapshot) => {
         const msgs: any[] = [];
         snapshot.forEach(doc => msgs.push({ id: doc.id, ...doc.data() }));
         setSupportChatMessages(msgs);
     });
     return () => unsubscribe();
  }, [showSupportChat, studentData?.id]);

  const handleSendSupportMessage = async (e?: React.FormEvent, directMessage?: string) => {
      e?.preventDefault();
      const msg = directMessage || supportMessage;
      if (!msg.trim()) return;
      
      if (!directMessage) setSupportMessage('');
      
      const currentBank = banks.find(b => b.id === selectedBankId);
      const deviceId = studentData?.id || localStorage.getItem('deviceId') || 'unknown';
      
      try {
          await addDoc(collection(db, 'support_chats'), {
              deviceId,
              studentName: studentData?.fullName || studentData?.name || 'طالب مجهول',
              message: msg,
              sender: 'student',
              createdAt: serverTimestamp(),
              bankName: currentBank?.name || ''
          });
      } catch (err) {
          console.error(err);
      }
  };

  useEffect(() => {
    if (chatEndRef.current) {
        chatEndRef.current.scrollIntoView({ behavior: 'smooth' });
    }
  }, [chatMessages]);

  const loadQuestionsForBank = async (bankId: string) => {
    setSelectedBankId(bankId);
    setQuestions([]);
    
    // Fallback timer to prevent infinite loading if getDocs blocks
    const qsFallbackTimer = setTimeout(() => {
        if (questions.length === 0 && selectedBankId === bankId) {
            alert('انتهى التوقيت المخصص لجلب الأسئلة. الرجاء التحقق من اتصالك بالإنترنت والمحاولة مجدداً.');
            setSelectedBankId(null);
        }
    }, 8000);

    try {
        const bankData = banks.find(b => b.id === bankId);
        if (bankData?.timeLimit && bankData.timeLimit > 0) {
            setTimeRemaining(bankData.timeLimit * 60);
        } else {
            setTimeRemaining(null);
        }

        const qSnap = await getDocs(query(collection(db, 'live_banks'), where('bankId', '==', bankId)));
        
        clearTimeout(qsFallbackTimer);
        
        const fetchedQs = qSnap.docs.map(d => ({ id: d.id, ...d.data() }));
        
        if (fetchedQs.length === 0) {
            alert('لا توجد أسئلة متاحة في هذا البنك حالياً.');
            setSelectedBankId(null);
            return;
        }

        // Shuffle choices for each question
        const preparedQuestions = fetchedQs.map((q: any) => {
          const choices = q.options.map((opt: string, i: number) => ({ text: opt, originalIndex: i }));
          return {
            ...q,
            choices: shuffle(choices)
          };
        });
        // Shuffle questions
        const shuffledQ = shuffle([...preparedQuestions]);
        setQuestions(shuffledQ);
        setStartTime(Date.now());
        
        localStorage.setItem('tamrediano_exam_state', JSON.stringify({
          bankId: bankId,
          questions: shuffledQ,
          selectedAnswers: {},
          bookmarked: {},
          currentIndex: 0,
          examMode: examMode
        }));
    } catch (err) {
        handleFirestoreError(err, OperationType.GET, 'live_banks');
        setSelectedBankId(null);
    }
  };

  const quitExam = () => {
      localStorage.removeItem('tamrediano_exam_state');
      setQuestions([]);
      setSelectedBankId(null);
      setSelectedAnswers({});
      setBookmarked({});
      setCurrentIndex(0);
      setIsFinished(false);
  };

  const handleSelectAnswer = (questionId: string, choiceOriginalIndex: number) => {
    if (selectedAnswers[questionId] !== undefined) return; // Already answered
    setSelectedAnswers(prev => ({ ...prev, [questionId]: choiceOriginalIndex }));
  };

  const toggleBookmark = (questionId: string) => {
    setBookmarked(prev => ({ ...prev, [questionId]: !prev[questionId] }));
  };

  const checkAndRecordStrike = async (text: string) => {
      const lower = text.toLowerCase();
      const hasBad = BAD_WORDS.some(w => lower.includes(w));
      if (hasBad && studentId) {
         try {
            const strikeRef = doc(db, 'strikes', studentId);
            const strikeSnap = await getDoc(strikeRef);
            if (strikeSnap.exists()) {
                const data = strikeSnap.data();
                if (data.count >= 2) {
                    await setDoc(strikeRef, { count: increment(1), banned: true }, { merge: true });
                } else {
                    await setDoc(strikeRef, { count: increment(1) }, { merge: true });
                }
            } else {
                await setDoc(strikeRef, { count: 1, banned: false });
            }
         } catch (e) {
             console.error("Strike update failed", e);
         }
         return true;
      }
      return false;
  };

  const handleReportLeaders = async () => {
     const q = questions[currentIndex];
     const initialMsg = `[إبلاغ عن سؤال]:\n${q.text}\n---\nالمشكلة: `;
     setSupportMessage(initialMsg);
     setShowSupportChat(true);
  };

  // AI Chat Logic
  const handleChatSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!chatInput.trim() && !chatFile) return;

    const userMessage = chatInput;
    const currentAttachment = chatFile;
    setChatInput('');
    setChatFile(null);
    
    // Check auto-ban
    if (userMessage) {
       const hasStriked = await checkAndRecordStrike(userMessage);
       if (hasStriked) {
           setChatMessages(prev => [...prev, { role: 'user', content: userMessage }, { role: 'model', content: 'نظام الرقابة الآلي: تم تسجيل إنذار ضد حسابك لاستخدام ألفاظ غير مقبولة.' }]);
           return;
       }
    }

    setChatMessages(prev => [...prev, { role: 'user', content: userMessage || 'تم إرفاق ملف.', hasAttachment: !!currentAttachment }]);
    setIsChatLoading(true);

    try {
      let contextQs: any[] = [];
      if (isFinished) {
          contextQs = questions.map((q, i) => ({
             index: i + 1,
             questionText: q.text,
             choices: q.options,
             correctAnswer: q.options[q.correct],
             studentSelectedAnswer: selectedAnswers[q.id] !== undefined ? q.options[selectedAnswers[q.id]] : "لم يُجب"
          }));
      } else {
          const q = questions[currentIndex];
          const studentSelected = selectedAnswers[q.id] !== undefined ? q.options[selectedAnswers[q.id]] : "لم يختر الطالب إجابة بعد";
          contextQs = [{ 
            index: currentIndex + 1,
            questionText: q.text, 
            choices: q.options,
            correctAnswer: q.options[q.correct],
            studentSelectedAnswer: studentSelected
          }];
      }
        
      const bodyPayload: any = {
        message: userMessage || 'Please refer to the attached document.',
        history: chatMessages,
        contextQuestions: contextQs,
        bankId: selectedBankId
      };
      
      if (currentAttachment) {
          bodyPayload.fileData = currentAttachment.base64;
          bodyPayload.mimeType = currentAttachment.mimeType;
      }

      const res = await fetch('/api/chat', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(bodyPayload)
      });
      const data = await res.json();
      if (!res.ok) {
         setChatMessages(prev => [...prev, { role: 'model', content: data.error || 'عذراً، حدث خطأ في الاتصال بالذكاء الاصطناعي.' }]);
      } else {
         setChatMessages(prev => [...prev, { role: 'model', content: data.message }]);
      }
    } catch (err) {
      setChatMessages(prev => [...prev, { role: 'model', content: 'عذراً، حدث خطأ في الاتصال بالذكاء الاصطناعي.' }]);
    }
    setIsChatLoading(false);
  };

  const copyChat = () => {
    const text = chatMessages.map(m => `${m.role === 'user' ? 'أنت' : 'الذكاء الاصطناعي'}: ${m.content}`).join('\n\n');
    navigator.clipboard.writeText(text);
    alert('تم نسخ المحادثة!');
  };

  const finishExam = async () => {
    
    const end = Date.now();
    const durationMins = Math.round((end - startTime) / 60000);
    setTimeTaken(durationMins);
    setIsFinished(true);
    
    // Calculate Score
    let correctCount = 0;
    const incorrectQs: any[] = [];
    questions.forEach(q => {
       const userAns = selectedAnswers[q.id];
       if (userAns === q.correct) {
           correctCount++;
       } else if (userAns !== undefined) {
           incorrectQs.push({
               text: q.text,
               explanation: q.explanation,
               correctAnswer: q.options[q.correct]
           });
       }
    });

    try {
        await setDoc(doc(collection(db, 'exam_results')), {
            studentId,
            studentName: studentData?.fullName || studentData?.name || 'غير معروف',
            score: correctCount,
            total: questions.length,
            timeTaken: durationMins,
            bankId: selectedBankId,
            bankName: banks.find(b => b.id === selectedBankId)?.name || 'غير معروف',
            createdAt: serverTimestamp(),
            incorrectIds: incorrectQs.map(iq => iq.text.substring(0, 50))
        });
    } catch (err) {
        console.error("Failed to save exam result", err);
    }
  };

  const handleGenerateStudyGuide = async () => {
      const incorrectQs = questions.filter(q => selectedAnswers[q.id] !== undefined && selectedAnswers[q.id] !== q.correct).map(q => ({
          text: q.text,
          explanation: q.explanation,
          correctAnswer: q.options[q.correct]
      }));

      if (incorrectQs.length === 0) {
          setStudyGuide("ممتاز! لقد أجبت على جميع الأسئلة بصورة صحيحة. استمر في هذا الأداء الرائع، ولا توجد أجزاء محددة تحتاج لمراجعتها في هذا الاختبار.");
          return;
      }

      setGeneratingGuide(true);
      try {
          const res = await fetch('/api/study-guide', {
              method: 'POST',
              headers: { 'Content-Type': 'application/json' },
              body: JSON.stringify({ incorrectQuestions: incorrectQs })
          });
          const data = await res.json();
          if (!res.ok) {
             alert(data.error || 'فشل توليد خطة المذاكرة.');
          } else {
             setStudyGuide(data.guide);
          }
      } catch (e) {
          console.error(e);
          alert('فشل توليد التلخيص.');
      }
      setGeneratingGuide(false);
  };

  const saveTaskList = () => {
      if (!studyGuide) return;
      const blob = new Blob([studyGuide], { type: "text/plain;charset=utf-8" });
      const url = URL.createObjectURL(blob);
      const a = document.createElement("a");
      a.href = url;
      a.download = "study-guide.txt";
      document.body.appendChild(a);
      a.click();
      document.body.removeChild(a);
      URL.revokeObjectURL(url);
  };

  const handleSubmitFeedback = async () => {
      try {
          await setDoc(doc(collection(db, 'exam_feedback')), {
              studentId,
              studentName: displayName || studentData?.name || 'طالب مجهول',
              rating,
              feedback,
              bankId: selectedBankId,
              bankName: banks.find(b => b.id === selectedBankId)?.name || 'بنك غير معروف',
              createdAt: serverTimestamp()
          });
          setFeedbackSubmitted(true);
      } catch (err) {
          console.error(err);
      }
  };

  if (questions.length === 0) {
      if (!selectedBankId) {
          return (
              <div className="min-h-screen bg-[#F8F9FA] text-[#1A1A1A] flex flex-col p-6 font-sans items-center" dir="rtl">
                  <header className="w-full max-w-4xl flex justify-between items-center mb-10 mt-10">
                      <h1 className="text-4xl font-serif italic text-[#D4AF37] tracking-wider drop-shadow-sm" style={{ fontFamily: '"Aref Ruqaa", serif' }}>تمريضيانو</h1>
                      <button onClick={() => { logout(); navigate('/login'); }} className="text-gray-500 hover:text-red-500 text-sm font-bold bg-white border border-gray-200 shadow-sm px-4 py-2 rounded-xl transition-all">
                          تسجيل خروج
                      </button>
                  </header>

                  <div className="max-w-4xl w-full">
                      <h2 className="text-2xl font-bold mb-6 text-gray-800 flex items-center gap-2">
                          <FolderOpen className="text-[#D4AF37]" size={28} />
                          اختر بنك الأسئلة
                      </h2>
                      
                      {loadingBanks ? (
                          <div className="text-center p-10 bg-white rounded-3xl border border-gray-100 shadow-sm">
                              <p className="text-gray-500 font-bold animate-pulse">جاري تحميل البنوك المتاحة...</p>
                          </div>
                      ) : banks.filter(b => {
                              if (b.isPublic !== false) return true;
                              if (!b.allowedNames) return false;
                              const normalize = (n: string) => n.trim().replace(/\s+/g, ' ');
                              const authName = normalize(studentData?.fullName || studentData?.name || '');
                              const names = b.allowedNames.split('\n').map(normalize).filter((n: string) => n);
                              return names.includes(authName);
                          }).length === 0 ? (
                          <div className="text-center p-10 bg-white rounded-3xl border border-gray-100 shadow-sm">
                              <p className="text-gray-500 font-bold">لا توجد بنوك أسئلة متاحة حالياً.</p>
                          </div>
                      ) : (
                          <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 gap-4">
                              {banks.filter(b => {
                                  if (b.isPublic !== false) return true;
                                  if (!b.allowedNames) return false;
                                  const normalize = (n: string) => n.trim().replace(/\s+/g, ' ');
                                  const authName = normalize(studentData?.fullName || studentData?.name || '');
                                  const names = b.allowedNames.split('\n').map(normalize).filter((n: string) => n);
                                  return names.includes(authName);
                              }).map(bank => (
                                  <button
                                      key={bank.id}
                                      onClick={() => setShowModeSelect(bank.id)}
                                      className="bg-white p-6 rounded-2xl border border-gray-200 shadow-sm hover:shadow-md hover:border-[#D4AF37]/50 transition-all text-right group flex flex-col items-start gap-3"
                                  >
                                      <div className="w-12 h-12 bg-[#F8F9FA] group-hover:bg-[#D4AF37]/10 text-gray-400 group-hover:text-[#D4AF37] rounded-xl flex items-center justify-center transition-colors">
                                          <FolderOpen size={24} />
                                      </div>
                                      <div>
                                          <h3 className="font-bold text-gray-900 mb-1">{bank.name}</h3>
                                          <p className="text-xs text-gray-500 line-clamp-2">انقر لبدء الاختبار</p>
                                      </div>
                                  </button>
                              ))}
                          </div>
                      )}
                  </div>

                  {/* Mode Select Modal */}
                  <AnimatePresence>
                    {showModeSelect && (
                      <div className="fixed inset-0 z-50 flex items-center justify-center p-4 bg-black/40 backdrop-blur-sm">
                        <motion.div 
                          initial={{ scale: 0.95, opacity: 0 }}
                          animate={{ scale: 1, opacity: 1 }}
                          exit={{ scale: 0.95, opacity: 0 }}
                          className="bg-white rounded-3xl p-8 border border-gray-100 shadow-2xl w-full max-w-md text-center"
                        >
                          {banks.find(b => b.id === showModeSelect)?.warningMessage && (
                              <div className="bg-yellow-50 text-orange-800 border border-yellow-200 p-4 rounded-xl mb-6 text-sm font-bold text-right shadow-inner">
                                  <AlertTriangle size={24} className="mb-2 text-orange-500 inline-block ml-2" />
                                  {banks.find(b => b.id === showModeSelect)?.warningMessage}
                              </div>
                          )}
                          <h2 className="text-2xl font-bold mb-2 text-gray-800">اختر نظام الاختبار</h2>
                          <p className="text-gray-500 text-sm mb-8 font-medium">اختر الطريقة التي تفضلها في عرض الإجابات والشرح</p>
                          
                          <div className="space-y-4">
                              <button onClick={() => { setExamMode('immediate'); loadQuestionsForBank(showModeSelect); }} className="w-full bg-white border-2 border-gray-100 hover:border-[#D4AF37] p-5 rounded-2xl text-right transition-all group shadow-sm hover:shadow-md">
                                  <div className="font-bold text-lg text-gray-800 mb-1 group-hover:text-[#D4AF37]">فوري (Immediate)</div>
                                  <div className="text-xs text-gray-500 font-medium">يظهر الصح والخطأ والشرح بعد كل سؤال مباشرة. الأفضل للمذاكرة.</div>
                              </button>
                              <button onClick={() => { setExamMode('deferred'); loadQuestionsForBank(showModeSelect); }} className="w-full bg-white border-2 border-gray-100 hover:border-[#D4AF37] p-5 rounded-2xl text-right transition-all group shadow-sm hover:shadow-md">
                                  <div className="font-bold text-lg text-gray-800 mb-1 group-hover:text-[#D4AF37]">مؤجل (Deferred)</div>
                                  <div className="text-xs text-gray-500 font-medium">تظهر الإجابات والشرح بعد إنهاء الاختبار بالكامل. الأفضل لاختبار مستواك.</div>
                              </button>
                          </div>
                          
                          <button onClick={() => setShowModeSelect(null)} className="mt-6 text-gray-500 hover:text-gray-800 text-sm font-bold transition-colors">إلغاء</button>
                        </motion.div>
                      </div>
                    )}
                  </AnimatePresence>

              </div>
          );
      }

      return (
          <div className="min-h-screen bg-[#F8F9FA] text-[#1A1A1A] flex flex-col justify-center items-center p-6 font-sans">
              <h1 className="text-4xl font-serif italic text-[#D4AF37] tracking-wider mb-6 drop-shadow-sm" style={{ fontFamily: '"Aref Ruqaa", serif' }}>تمريضيانو</h1>
              <div className="bg-white rounded-3xl p-8 border border-gray-100 shadow-[0_10px_40px_-10px_rgba(0,0,0,0.1)] max-w-md text-center w-full">
                  <p className="text-gray-500 font-bold animate-pulse">جاري تحميل الأسئلة...</p>
              </div>
          </div>
      );
  }

  const currentQ = questions[currentIndex];
  const hasAnsweredCurrent = selectedAnswers[currentQ.id] !== undefined;
  const isCorrect = selectedAnswers[currentQ.id] === currentQ.correct;

  if (isFinished) {
      const correctCount = questions.filter(q => selectedAnswers[q.id] === q.correct).length;
      const incorrectQs = questions.filter(q => selectedAnswers[q.id] !== q.correct);

      return (
        <div className="min-h-screen bg-[#F8F9FA] text-[#1A1A1A] flex flex-col font-sans overflow-y-auto p-4 md:p-8" dir="rtl">
            <div className="max-w-3xl mx-auto w-full bg-white rounded-3xl p-8 shadow-[0_10px_40px_-10px_rgba(0,0,0,0.05)] border border-gray-100 space-y-8">
               
               <div className="text-center border-b border-gray-100 pb-8">
                  <h1 className="text-4xl font-serif italic text-[#D4AF37] tracking-wider mb-4 drop-shadow-sm" style={{ fontFamily: '"Aref Ruqaa", serif' }}>تمريضيانو</h1>
                  <h2 className="text-2xl font-bold mb-2 text-gray-800">نتيجة الاختبار</h2>
                  <div className="flex justify-center gap-4 mt-6">
                     <div className="bg-gray-50 border border-gray-200 rounded-2xl p-4 w-32 shadow-sm">
                        <div className="text-3xl font-bold text-[#D4AF37] mb-1">{correctCount} <span className="text-sm text-gray-400">/ {questions.length}</span></div>
                        <div className="text-[10px] text-gray-500 font-bold uppercase tracking-wider">الإجابات الصحيحة</div>
                     </div>
                     <div className="bg-gray-50 border border-gray-200 rounded-2xl p-4 w-32 shadow-sm">
                        <div className="text-3xl font-bold text-gray-600 mb-1">{timeTaken} <span className="text-sm text-gray-400">دقيقة</span></div>
                        <div className="text-[10px] text-gray-500 font-bold uppercase tracking-wider">الوقت المستغرق</div>
                     </div>
                  </div>
               </div>

               {incorrectQs.length > 0 && (
                   <div className="space-y-6">
                       <h3 className="text-xl font-bold text-red-600 border-b border-red-100 pb-2 inline-block">النقاط التي أخطأت فيها ({incorrectQs.length})</h3>
                       
                       <div className="flex flex-col sm:flex-row items-start sm:items-center gap-4">
                           <button onClick={handleGenerateStudyGuide} disabled={generatingGuide} className="bg-gradient-to-r from-[#D4AF37] to-[#C5A059] text-white font-bold py-3 px-6 rounded-xl flex items-center gap-2 transition-all shadow-lg hover:shadow-xl hover:-translate-y-1 duration-300 disabled:opacity-50 disabled:transform-none text-sm">
                               {generatingGuide ? 'جاري التحليل من الذكاء الاصطناعي...' : 'اعرف تذاكر إيه ✨'}
                           </button>
                           {studyGuide && (
                               <button onClick={saveTaskList} className="bg-white hover:bg-gray-50 text-[#1A1A1A] border-2 border-[#D4AF37] shadow-md font-bold py-3 px-6 rounded-xl hover:shadow-lg transition-all duration-300 text-sm">
                                  تحميل كملف نصي (.txt)
                               </button>
                           )}
                       </div>

                       {studyGuide && (
                           <div id="study-guide-content" className="bg-[#fff9e6] border border-[#D4AF37]/30 rounded-2xl p-6 text-gray-800 text-sm leading-relaxed whitespace-pre-wrap shadow-inner font-medium">
                               {studyGuide}
                           </div>
                       )}

                       <div className="space-y-4">
                           {incorrectQs.map((q, idx) => {
                                const studentAns = selectedAnswers[q.id];
                                return (
                               <div key={idx} className="bg-white p-6 rounded-2xl border border-gray-200 shadow-sm space-y-4">
                                    <div className="flex justify-between items-start">
                                       <span className="bg-red-50 text-red-600 border border-red-200 text-[10px] px-2.5 py-1 rounded-lg font-bold">سؤال رقم {questions.indexOf(q) + 1} ({banks.find(b => b.id === q.bankId)?.name || 'مجهول'})</span>
                                    </div>
                                    <p className="font-bold text-[#1A1A1A] leading-relaxed text-sm text-right">{q.text}</p>
                                    {/* Choice options list */}
                                    <div className="space-y-2 mt-3" dir="rtl">
                                        {(q.choices || q.options?.map((opt: string, i: number) => ({ text: opt, originalIndex: i })) || []).map((choice: any, cIdx: number) => {
                                            const isSelected = studentAns === choice.originalIndex;
                                            const isCorrect = q.correct === choice.originalIndex;
                                            
                                            let choiceClass = "border text-right p-3 rounded-xl text-xs font-bold leading-relaxed w-full flex items-center justify-between ";
                                            if (isCorrect) {
                                                choiceClass += "border-green-300 bg-green-50/70 text-green-800";
                                            } else if (isSelected) {
                                                choiceClass += "border-red-300 bg-red-50/70 text-red-800";
                                            } else {
                                                choiceClass += "border-gray-100 bg-gray-50 text-gray-700 opacity-80";
                                            }
                                            
                                            return (
                                                <div key={cIdx} className={choiceClass}>
                                                    <div className="flex items-center gap-2">
                                                        <span className={`w-5 h-5 rounded-full flex items-center justify-center text-[10px] border font-bold ${
                                                            isCorrect ? "bg-green-600 text-white border-green-700" :
                                                            (isSelected ? "bg-red-600 text-white border-red-700" : "bg-gray-200 text-gray-400 border-gray-300")
                                                        }`}>
                                                            {String.fromCharCode(65 + cIdx)}
                                                        </span>
                                                        <span>{choice.text}</span>
                                                    </div>
                                                    {isCorrect && <span className="bg-green-100 text-green-700 font-black px-2 py-0.5 rounded text-[10px]">الإجابة الصحيحة ✔</span>}
                                                    {isSelected && <span className="bg-red-100 text-red-700 font-black px-2 py-0.5 rounded text-[10px]">إجابتك ✖</span>}
                                                </div>
                                            );
                                        })}
                                    </div>

                                    {/* Explanation card */}
                                    <div className="text-xs text-gray-600 bg-amber-50/40 p-4 rounded-xl border border-amber-100 leading-relaxed shadow-inner font-medium mt-2">
                                        <div className="font-bold text-amber-800 mb-1">💡 التفسير والشرح:</div>
                                        {q.explanation || 'لا يوجد تفسير متاح لهذا السؤال.'}
                                    </div>
                                </div>
                                );
                            })}
                       </div>
                   </div>
               )}

               <div className="border-t border-gray-100 pt-8 mt-8">
                   <h3 className="text-lg font-bold mb-4 text-center text-gray-800">ما رأيك في هذا الاختبار؟</h3>
                   {!feedbackSubmitted ? (
                       <div className="space-y-4 flex flex-col items-center">
                           <div className="flex gap-2">
                               {[1,2,3,4,5].map(star => (
                                   <button key={star} onClick={() => setRating(star)} className={`text-4xl transition-transform hover:scale-110 drop-shadow-sm ${rating >= star ? 'text-[#D4AF37]' : 'text-gray-300'}`}>
                                       ★
                                   </button>
                               ))}
                           </div>
                           <textarea 
                             value={feedback}
                             onChange={e => setFeedback(e.target.value)}
                             placeholder="اكتب تعليقك أو أي ملاحظات هنا (اختياري)..."
                             className="w-full max-w-lg bg-gray-50 border border-gray-200 rounded-xl p-4 text-sm focus:border-[#D4AF37] focus:ring-1 focus:ring-[#D4AF37] outline-none resize-none h-24 text-gray-800 font-medium"
                           />
                           <button disabled={rating === 0} onClick={handleSubmitFeedback} className="bg-[#1A1A1A] hover:bg-gray-800 text-white font-bold py-3 px-8 rounded-xl transition-all shadow-md disabled:opacity-50">
                               إرسال التقييم
                           </button>
                       </div>
                   ) : (
                       <div className="text-center text-green-700 font-bold bg-green-50 border border-green-200 rounded-xl p-4 shadow-sm">
                           شكراً لتقييمك! بالتوفيق يا دكتور.
                       </div>
                   )}
               </div>

               <div className="flex flex-col md:flex-row justify-center gap-4 mt-8 pt-6 border-t border-gray-100">
                    <button onClick={() => {
                        setIsFinished(false);
                        setSelectedAnswers({});
                        setCurrentIndex(0);
                        const bankData = banks.find(b => b.id === selectedBankId);
                        setTimeRemaining(bankData?.timeLimit ? bankData.timeLimit * 60 : null);
                        setStartTime(Date.now());
                        localStorage.removeItem('tamrediano_exam_state');
                        window.scrollTo(0,0);
                    }} className="bg-white hover:bg-gray-50 text-[#D4AF37] border-2 border-[#D4AF37] font-bold py-3 px-8 rounded-xl transition-all shadow-md flex items-center justify-center gap-2">
                        <RefreshCw size={18} /> إعادة الاختبار
                    </button>
                    <button onClick={() => {
                        localStorage.removeItem('tamrediano_exam_state');
                        window.location.href = '/exam'; 
                    }} className="bg-gray-100 hover:bg-gray-200 text-gray-800 font-bold py-3 px-8 rounded-xl transition-all shadow-md flex items-center justify-center gap-2">
                        <LogOut size={18} /> الرجوع للواجهة الرئيسية
                    </button>
               </div>

            </div>
        </div>
      );
  }

  if (isBannedState) {
     return (
        <div className="min-h-screen bg-red-600 flex flex-col items-center justify-center p-6 text-white text-center" dir="rtl">
           <ShieldAlert size={80} className="mb-6 opacity-90" />
           <h1 className="text-4xl font-bold mb-4">حسابك محظور من النظام</h1>
           <p className="text-xl mb-8 opacity-80">تم حظر هذا الحساب نهائياً بسبب انتهاكات متكررة للسياسات أو الدخول من أجهزة متعددة.</p>
           <button onClick={() => { logout(); navigate('/login'); }} className="bg-white text-red-600 px-8 py-3 rounded-xl font-bold hover:bg-gray-100 transition-colors shadow-xl">
              العودة وتسجيل الخروج
           </button>
        </div>
     );
  }

  return (
    <div 
       className={`min-h-screen font-sans pb-24 transition-colors ${themeMode === 'light' ? 'bg-[#F8F9FA] text-[#1A1A1A]' : 'bg-[#FFF8E7] text-[#3e2723]'}`} 
       dir="rtl"
       style={{ filter: `brightness(${brightness}%)` }}
    >
      
      {/* Settings Modal */}
      <AnimatePresence>
        {showSettings && (
          <div className="fixed inset-0 z-50 flex items-center justify-center p-4 bg-black/50 backdrop-blur-sm">
            <motion.div 
              initial={{ scale: 0.95, opacity: 0 }}
              animate={{ scale: 1, opacity: 1 }}
              exit={{ scale: 0.95, opacity: 0 }}
              className="bg-white rounded-2xl p-6 border border-gray-200 shadow-2xl w-full max-w-sm"
            >
              <div className="flex justify-between items-center mb-6 border-b border-gray-100 pb-2">
                 <h2 className="text-xl font-bold text-gray-800 flex items-center gap-2"><Settings size={20} className="text-[#D4AF37]"/> إعدادات الاختبار</h2>
                 <button onClick={() => {
                     setShowSettings(false);
                     if (displayName && displayName !== studentData?.name) {
                         const newData = { ...studentData, name: displayName, fullName: displayName };
                         // @ts-ignore
                         loginStudent(newData);
                     }
                 }} className="text-gray-400 hover:text-gray-700 bg-gray-50 border border-gray-200 rounded-full p-1"><X size={16}/></button>
              </div>
              
              <div className="space-y-5">
                 <div>
                    <label className="block text-sm font-bold text-gray-700 mb-1">اسم العرض</label>
                    <input type="text" value={displayName} onChange={e => setDisplayName(e.target.value)} className="w-full bg-[#FAF9F6] border border-gray-200 rounded-xl px-3 py-2.5 text-sm font-bold focus:border-[#D4AF37] outline-none" />
                 </div>
                 
                 <div>
                    <label className="block text-sm font-bold text-gray-700 mb-3">نمط الشاشة</label>
                    <div className="flex gap-2">
                       <button onClick={() => setThemeMode('light')} className={`flex-1 py-2 rounded-xl text-sm font-bold border ${themeMode === 'light' ? 'border-[#D4AF37] bg-white text-[#D4AF37]' : 'border-gray-200 bg-gray-50 text-gray-500'}`}><Sun size={14} className="inline mr-1"/> ساطع</button>
                       <button onClick={() => setThemeMode('sepia')} className={`flex-1 py-2 rounded-xl text-sm font-bold border ${themeMode === 'sepia' ? 'border-[#D4AF37] bg-white text-[#D4AF37]' : 'border-gray-200 bg-gray-50 text-gray-500'}`}><Moon size={14} className="inline mr-1"/> دافئ</button>
                    </div>
                 </div>

                 <div>
                    <label className="block text-sm font-bold text-gray-700 mb-1">السطوع ({brightness}%)</label>
                    <input type="range" min="50" max="100" value={brightness} onChange={e => setBrightness(Number(e.target.value))} className="w-full accent-[#D4AF37]" />
                 </div>

                 <div className="pt-4 border-t border-gray-100">
                    <button onClick={() => {
                        localStorage.removeItem('tamrediano_chat_history'); // example clear
                        // clear any unsent drafts or heavy arrays
                        window.location.reload();
                    }} className="w-full bg-red-50 hover:bg-red-100 text-red-600 border border-red-200 font-bold py-2 rounded-xl text-sm transition-colors flex items-center justify-center gap-2">
                       <Trash size={16} /> تنظيف الذاكرة المؤقتة لسرعة التطبيق
                    </button>
                 </div>
              </div>
            </motion.div>
          </div>
        )}
      </AnimatePresence>

      {/* Admin Upgrade Modal */}
      <AnimatePresence>
        {showAdminUpgrade && (
          <div className="fixed inset-0 z-50 flex items-center justify-center p-4 bg-black/50 backdrop-blur-sm">
            <motion.div 
              initial={{ scale: 0.95, opacity: 0 }}
              animate={{ scale: 1, opacity: 1 }}
              exit={{ scale: 0.95, opacity: 0 }}
              className="bg-white rounded-2xl p-6 border border-gray-200 shadow-2xl w-full max-w-sm"
            >
              <h2 className="text-xl font-bold mb-4 text-[#D4AF37] font-serif italic" style={{ fontFamily: '"Aref Ruqaa", serif' }}>دخول الإدارة</h2>
              <input
                type="password"
                placeholder="كلمة المرور"
                value={adminPassword}
                onChange={e => setAdminPassword(e.target.value)}
                className="w-full px-4 py-3 rounded-xl border border-gray-200 bg-gray-50 text-gray-900 focus:outline-none focus:border-[#D4AF37] focus:ring-1 focus:ring-[#D4AF37] mb-4 text-left font-medium"
                autoFocus
              />
              <div className="flex gap-2">
                <button onClick={handleAdminUpgrade} className="bg-[#D4AF37] hover:bg-[#C5A059] text-white flex-1 py-2 rounded-xl font-bold transition-all shadow-md">تأكيد</button>
                <button onClick={() => setShowAdminUpgrade(false)} className="bg-gray-100 hover:bg-gray-200 text-gray-700 flex-1 py-2 rounded-xl font-bold transition-all border border-gray-200 shadow-sm">إلغاء</button>
              </div>
            </motion.div>
          </div>
        )}
      </AnimatePresence>

      {/* Top Header */}
      <header className={`sticky top-0 z-10 border-b border-gray-200 px-4 py-3 flex items-center justify-between shadow-sm ${themeMode === 'light' ? 'bg-white' : 'bg-[#fffdf7]'}`}>
        <div className="flex items-center gap-3">
            <button onClick={() => { setSelectedBankId(null); setQuestions([]); }} className="bg-gray-100 hover:bg-gray-200 text-gray-700 p-2 rounded-full transition-colors shadow-sm">
                <ChevronRight size={16} />
            </button>
            <h1 className="text-2xl font-serif italic text-[#D4AF37] tracking-wider drop-shadow-sm" style={{ fontFamily: '"Aref Ruqaa", serif' }}>تمريضيانو</h1>
        </div>
        <div className="flex items-center gap-4 text-xs font-mono font-bold text-gray-600">
           {timeRemaining !== null && (
               <span className={`px-2 py-1 rounded font-bold ${timeRemaining < 60 ? 'bg-red-100 text-red-600 animate-pulse' : 'bg-gray-100 text-gray-700'}`}>
                   {Math.floor(timeRemaining / 60)}:{String(timeRemaining % 60).padStart(2, '0')}
               </span>
           )}
           <button onClick={() => setShowSettings(true)} className="hidden md:flex text-[10px] bg-gray-50 hover:bg-gray-100 border border-gray-200 text-gray-600 px-3 py-1.5 rounded-full transition-all shadow-sm items-center gap-1">
             <Settings size={12}/> الإعدادات
           </button>
           <button onClick={() => setShowAdminUpgrade(true)} className="text-[10px] bg-gray-50 hover:bg-gray-100 border border-gray-200 text-gray-600 px-3 py-1.5 rounded-full transition-all shadow-sm hidden md:inline-block">
             إدارة
           </button>
           <span>{Math.round(((currentIndex) / questions.length) * 100)}%</span>
        </div>
      </header>

      {/* Progress Bar */}
      <div className="w-full h-1 bg-gray-200">
        <div 
          className="h-full bg-gradient-to-r from-[#D4AF37] to-[#e4c868] transition-all duration-300 shadow-[0_0_10px_rgba(212,175,55,0.4)]"
          style={{ width: `${((currentIndex + 1) / questions.length) * 100}%` }}
        />
      </div>

      {/* Question Carousel Navigator */}
      <div className="px-4 py-3 overflow-x-auto whitespace-nowrap flex gap-2 bg-white border-b border-gray-100 shadow-sm nav-scroll">
        {questions.map((q, idx) => {
          const answered = selectedAnswers[q.id] !== undefined;
          const correct = selectedAnswers[q.id] === q.correct;
          const isBookmarked = bookmarked[q.id];
          
          return (
            <button
              key={q.id}
              onClick={() => setCurrentIndex(idx)}
              className={cn(
                "w-10 h-10 rounded flex-shrink-0 flex items-center justify-center font-bold text-xs transition-colors border shadow-sm",
                currentIndex === idx ? "bg-[#D4AF37] text-white border-[#D4AF37]" : "bg-white text-gray-500 border-gray-200 hover:bg-gray-50",
                examMode === 'immediate' && answered && correct && currentIndex !== idx && "bg-green-50 text-green-700 border-green-200",
                examMode === 'immediate' && answered && !correct && currentIndex !== idx && "bg-red-50 text-red-700 border-red-200",
                examMode === 'deferred' && answered && currentIndex !== idx && "bg-[#D4AF37]/10 text-[#D4AF37] border-[#D4AF37]/30",
                isBookmarked && currentIndex !== idx && "bg-yellow-50 text-yellow-700 border-yellow-200"
              )}
            >
              {idx + 1}
            </button>
          );
        })}
      </div>

      {/* Question Container */}
      <main className="px-4 py-8 max-w-2xl mx-auto w-full">
        <AnimatePresence mode="wait">
          <motion.div
            key={currentQ.id}
            initial={{ opacity: 0, x: -20 }}
            animate={{ opacity: 1, x: 0 }}
            exit={{ opacity: 0, x: 20 }}
            className="bg-white rounded-2xl p-6 shadow-[0_10px_40px_-10px_rgba(0,0,0,0.05)] border border-gray-100"
          >
            <div className="flex justify-between items-start mb-6">
              <span className="px-3 py-1 rounded-full bg-gray-50 text-gray-600 border border-gray-200 text-[10px] font-bold uppercase tracking-widest shadow-sm">السؤال {String(currentIndex + 1).padStart(2, '0')}</span>
              <div className="flex gap-2">
                  <button 
                    onClick={() => setShowReportModal(true)}
                    className="flex items-center gap-2 text-xs font-bold px-3 py-1 rounded-lg border text-red-500 hover:text-red-700 bg-white border-red-200 hover:bg-red-50 transition-all shadow-sm"
                  >
                    <AlertTriangle size={14} />
                    <span>إبلاغ</span>
                  </button>
                  <button 
                    onClick={() => toggleBookmark(currentQ.id)}
                    className={cn("flex items-center gap-2 text-xs font-bold px-3 py-1 rounded-lg border transition-all shadow-sm", bookmarked[currentQ.id] ? "text-[#D4AF37] bg-yellow-50 border-[#D4AF37]/30" : "text-gray-500 hover:text-gray-700 bg-white border-gray-200 hover:bg-gray-50")}
                  >
                    <Bookmark size={14} className={bookmarked[currentQ.id] ? "fill-current" : ""} />
                    <span>حفظ للمراجعة</span>
                  </button>
              </div>
            </div>
            
            <h2 className="text-xl font-bold text-gray-900 leading-relaxed mb-6">
              {currentQ.text}
            </h2>

            {currentQ.imageUrl && (
              <div 
                className="mb-6 relative rounded-xl overflow-hidden border border-gray-200 shadow-sm group bg-gray-100 cursor-pointer"
                onClick={() => setLightboxImage(currentQ.imageUrl)}
              >
                <img 
                  src={currentQ.imageUrl} 
                  alt="مرفق السؤال" 
                  className="w-full h-auto object-cover dim-image transition-transform group-hover:scale-105"
                />
                <div className="absolute inset-0 bg-black/20 opacity-0 group-hover:opacity-100 flex items-center justify-center transition-opacity">
                   <Maximize2 className="text-white drop-shadow-md" size={32} />
                </div>
              </div>
            )}

            <div className="space-y-3">
              {currentQ.choices.map((choice: any, idx: number) => {
                const isSelected = selectedAnswers[currentQ.id] === choice.originalIndex;
                const isActualCorrect = choice.originalIndex === currentQ.correct;
                
                let btnClass = "border border-gray-200 bg-white hover:bg-gray-50 transition-colors text-right flex items-center group shadow-sm";
                
                if (hasAnsweredCurrent) {
                  if (examMode === 'immediate') {
                      if (isSelected && isActualCorrect) {
                         btnClass = "border border-green-400 bg-green-50 text-right flex items-center shadow-sm";
                      } else if (isSelected && !isActualCorrect) {
                         btnClass = "border border-red-400 bg-red-50 text-right flex items-center shadow-sm";
                      } else if (isActualCorrect) {
                         btnClass = "border border-green-400 bg-green-50 text-right flex items-center shadow-sm";
                      } else {
                         btnClass = "border border-gray-100 bg-gray-50 opacity-60 text-right flex items-center shadow-none";
                      }
                  } else {
                      // Deferred Mode
                      if (isSelected) {
                         btnClass = "border border-[#D4AF37] bg-[#D4AF37]/10 text-right flex items-center shadow-sm";
                      } else {
                         btnClass = "border border-gray-100 bg-gray-50 opacity-60 text-right flex items-center shadow-none";
                      }
                  }
                }

                let spanClass = "bg-gray-50 group-hover:bg-[#D4AF37]/10 text-gray-600 group-hover:text-[#D4AF37] border border-gray-200 group-hover:border-[#D4AF37]/30";
                if (hasAnsweredCurrent) {
                    if (examMode === 'immediate') {
                         spanClass = isActualCorrect ? "bg-green-600 text-white border-green-700" : (isSelected && !isActualCorrect ? "bg-red-600 text-white border-red-700" : "bg-gray-100 text-gray-400 border-gray-200");
                    } else {
                         spanClass = isSelected ? "bg-[#D4AF37] text-white border-[#D4AF37]" : "bg-gray-100 text-gray-400 border-gray-200";
                    }
                }

                return (
                  <button
                    key={idx}
                    disabled={hasAnsweredCurrent}
                    onClick={() => handleSelectAnswer(currentQ.id, choice.originalIndex)}
                    className={cn(
                      "w-full p-4 rounded-xl font-bold text-gray-800 transition-all gap-4",
                      btnClass
                    )}
                  >
                    <span className={cn(
                      "w-8 h-8 flex items-center justify-center rounded-lg font-mono transition-colors shadow-sm text-sm",
                      spanClass
                    )}>
                      {String.fromCharCode(65 + idx)}
                    </span>
                    <span className="leading-relaxed">{choice.text}</span>
                  </button>
                );
              })}
            </div>

            <AnimatePresence>
              {hasAnsweredCurrent && examMode === 'immediate' && (
                <motion.div
                  initial={{ opacity: 0, height: 0, marginTop: 0 }}
                  animate={{ opacity: 1, height: 'auto', marginTop: 24 }}
                  className="bg-gray-50 rounded-2xl border border-gray-200 flex flex-col shadow-inner overflow-hidden"
                >
                  <div className="p-4 bg-white border-b border-gray-200 flex items-center gap-3 shadow-sm">
                    <div className="w-8 h-8 rounded-lg bg-[#D4AF37] flex items-center justify-center text-white text-lg font-bold shadow-md">G</div>
                    <div>
                      <div className="text-sm font-bold text-gray-900">الذكاء الاصطناعي (Gemini)</div>
                      <div className="text-[10px] text-gray-500 font-bold uppercase tracking-widest">شرح مبسط للإجابة</div>
                    </div>
                  </div>
                  <div className="flex-1 p-5 flex flex-col gap-4 text-right" dir="rtl">
                    <div className="p-4 bg-white rounded-xl rounded-tr-none text-sm font-medium leading-relaxed text-gray-800 border border-gray-200 shadow-sm">
                      {currentQ.explanation}
                    </div>
                  </div>
                  
                  <div className="p-4 border-t border-gray-200 flex gap-3 bg-white">
                    <button 
                      onClick={() => setIsChatOpen(true)}
                      className="flex-1 bg-white hover:bg-gray-50 text-gray-800 shadow-sm border border-gray-200 rounded-xl py-2.5 px-4 transition-transform hover:scale-105 font-bold flex items-center justify-center gap-2 text-xs"
                    >
                      🗣️ ناقش الذكاء الاصطناعي
                    </button>
                    <button onClick={handleReportLeaders} className="flex-1 bg-red-50 hover:bg-red-100 text-red-700 border border-red-200 shadow-sm rounded-xl py-2.5 px-4 font-bold hover:scale-105 transition-transform flex items-center justify-center gap-2 text-xs">
                       <AlertTriangle size={16} /> بلغ القادة عن خطأ
                    </button>
                  </div>
                </motion.div>
              )}
            </AnimatePresence>
          </motion.div>
        </AnimatePresence>
        
        {/* Navigation Buttons for Previous / Next */}
        <div className="flex justify-between items-center mt-8 max-w-2xl mx-auto w-full">
            <button 
             onClick={() => setCurrentIndex(Math.max(0, currentIndex - 1))}
             disabled={currentIndex === 0}
             className="px-6 py-3 rounded-xl font-bold bg-white text-gray-700 hover:text-gray-900 border border-gray-200 hover:bg-gray-50 shadow-sm transition-all disabled:opacity-50"
            >
                السابق
            </button>
            
            {currentIndex === questions.length - 1 ? (
                <button 
                 onClick={finishExam}
                 className="px-8 py-3 rounded-xl font-bold bg-gradient-to-r from-[#D4AF37] to-[#C5A059] text-white hover:shadow-xl hover:-translate-y-1 transition-all duration-300 shadow-lg"
                >
                    إنهاء الاختبار
                </button>
            ) : (
                <button 
                 onClick={() => setCurrentIndex(Math.min(questions.length - 1, currentIndex + 1))}
                 disabled={currentIndex === questions.length - 1}
                 className="px-8 py-3 rounded-xl font-bold bg-[#1A1A1A] text-white hover:bg-black disabled:opacity-50 transition-all shadow-md"
                >
                    التالي
                </button>
            )}
        </div>
      </main>

      {/* AI Chat Drawer */}
      <AnimatePresence>
        {isChatOpen && (
          <>
            <motion.div 
               initial={{ opacity: 0 }} animate={{ opacity: 1 }} exit={{ opacity: 0 }}
               className="fixed inset-0 bg-black/50 z-40 backdrop-blur-sm"
               onClick={() => setIsChatOpen(false)}
            />
            <motion.div
               initial={{ y: '100%' }} animate={{ y: 0 }} exit={{ y: '100%' }}
               transition={{ type: 'spring', damping: 25, stiffness: 200 }}
               className="fixed bottom-0 left-0 right-0 h-[85vh] bg-white border-t border-gray-200 z-50 rounded-t-3xl shadow-[0_-10px_40px_-10px_rgba(0,0,0,0.15)] flex flex-col pt-2 max-w-3xl mx-auto"
            >
               <div className="w-12 h-1.5 bg-gray-300 rounded-full mx-auto mb-2" />
               <div className="px-6 py-4 bg-white border-b border-gray-100 flex justify-between items-center rounded-t-3xl shadow-sm">
                 <div className="flex items-center gap-3">
                    <div className="w-8 h-8 rounded-lg bg-[#D4AF37] flex items-center justify-center text-white text-lg font-bold shadow-md">G</div>
                    <div>
                      <h2 className="font-bold text-sm text-gray-900">محادثة الذكاء الاصطناعي</h2>
                      <div className="text-[10px] text-gray-500 font-bold uppercase tracking-widest">مبني على Gemini 1.5</div>
                    </div>
                 </div>
                 <div className="flex items-center gap-2">
                    <button onClick={copyChat} className="p-2 text-gray-500 hover:text-gray-800 bg-gray-50 border border-gray-200 rounded-full shadow-sm transition-colors">
                      <Copy size={16} />
                    </button>
                    <button onClick={() => setIsChatOpen(false)} className="p-2 text-gray-500 hover:text-gray-800 bg-gray-50 border border-gray-200 rounded-full shadow-sm transition-colors">
                      <X size={16} />
                    </button>
                 </div>
               </div>

               <div className="flex-1 overflow-y-auto p-6 space-y-4 bg-[#F8F9FA]">
                 {chatMessages.length === 0 && (
                     <div className="text-center text-gray-600 font-bold mt-10 text-xs bg-white border border-gray-200 p-4 rounded-xl shadow-sm inline-block mx-auto flex">
                         اسأل الذكاء الاصطناعي أي سؤال بخصوص السؤال الحالي أو المواد العلمية.
                     </div>
                 )}
                 {chatMessages.map((msg, i) => (
                   <div key={i} className={cn("flex", msg.role === 'user' ? "justify-start" : "justify-end")}>
                     <div className={cn(
                       "max-w-[85%] rounded-xl p-4 text-xs font-bold leading-relaxed text-right shadow-sm",
                       msg.role === 'user' 
                         ? "bg-[#D4AF37] text-white rounded-br-none shadow-[0_4px_14px_0_rgba(212,175,55,0.39)]" 
                         : "bg-white text-gray-800 rounded-bl-none border border-gray-200"
                     )}>
                       {msg.role === 'model' ? (
                          <div className="markdown-body text-gray-800">
                             <ReactMarkdown>{msg.content}</ReactMarkdown>
                          </div>
                       ) : (
                          msg.content
                       )}
                     </div>
                   </div>
                 ))}
                 {isChatLoading && (
                    <div className="flex justify-end">
                       <div className="bg-white border border-gray-200 rounded-xl rounded-bl-none p-4 flex gap-1 items-center shadow-sm">
                          <div className="w-1.5 h-1.5 bg-gray-400 rounded-full animate-pulse" />
                          <div className="w-1.5 h-1.5 bg-gray-400 rounded-full animate-pulse" style={{ animationDelay: '0.1s' }} />
                          <div className="w-1.5 h-1.5 bg-gray-400 rounded-full animate-pulse" style={{ animationDelay: '0.2s' }} />
                       </div>
                    </div>
                 )}
                 <div ref={chatEndRef} />
               </div>

               <div className="p-4 bg-white border-t border-gray-100 shadow-[0_-4px_10px_-10px_rgba(0,0,0,0.1)]">
                 <form onSubmit={handleChatSubmit} className="flex flex-col gap-2 bg-gray-50 border border-gray-200 rounded-2xl p-2 shadow-inner">
                   {chatFile && (
                     <div className="flex items-center gap-2 bg-gray-200 px-3 py-1.5 rounded-lg self-start text-xs font-bold w-full mx-2 mt-1">
                        <span className="flex-1 truncate">{chatFile.file.name}</span>
                        <button type="button" onClick={() => setChatFile(null)} className="text-red-500 hover:text-red-700 font-bold ml-2">x</button>
                     </div>
                   )}
                   <div className="flex items-center gap-2 w-full">
                     <label className="p-2 text-gray-500 hover:bg-gray-200 hover:text-[#D4AF37] rounded-full cursor-pointer transition-colors shrink-0">
                       <Paperclip size={20} />
                       <input 
                         type="file" 
                         className="hidden" 
                         accept="image/*,application/pdf"
                         onChange={(e) => {
                             const file = e.target.files?.[0];
                             if(file) {
                                if(file.size > 5 * 1024 * 1024) return alert("حجم الملف يجب أن يكون أقل من 5 ميجا.");
                                const reader = new FileReader();
                                reader.onload = () => {
                                   const base64 = (reader.result as string).split(',')[1];
                                   setChatFile({ file, base64, mimeType: file.type });
                                };
                                reader.readAsDataURL(file);
                             }
                         }}
                       />
                     </label>
                     <input 
                       type="text" 
                       value={chatInput} 
                       onChange={e => setChatInput(e.target.value)}
                       placeholder="اسأل سؤالك هنا..." 
                       className="flex-1 bg-transparent border-none focus:ring-0 outline-none text-gray-900 text-sm font-bold placeholder-gray-500"
                     />
                     <button 
                       type="submit" 
                       disabled={(!chatInput.trim() && !chatFile) || isChatLoading}
                       className="bg-[#1A1A1A] hover:bg-black text-white p-2.5 rounded-full transition-transform hover:scale-105 disabled:opacity-50 shadow-md shrink-0"
                     >
                       <Send size={16} className="rotate-180" />
                     </button>
                   </div>
                 </form>
               </div>
            </motion.div>
          </>
        )}
      </AnimatePresence>

      {/* Lightbox / Zoom */}
      <AnimatePresence>
         {lightboxImage && (
            <motion.div
               initial={{ opacity: 0 }} animate={{ opacity: 1 }} exit={{ opacity: 0 }}
               className="fixed inset-0 z-[100] bg-white/95 flex flex-col backdrop-blur-md"
            >
               <div className="p-4 flex justify-end">
                  <button onClick={() => setLightboxImage(null)} className="text-gray-600 p-2 bg-gray-100 rounded-full hover:bg-gray-200 transition-colors shadow-sm">
                     <X size={24} />
                  </button>
               </div>
               <div className="flex-1 flex items-center justify-center p-4 overflow-auto">
                  <img src={lightboxImage} alt="Fullscreen" className="max-w-full max-h-[85vh] object-contain rounded-xl dim-image border border-gray-200 shadow-2xl" />
               </div>
            </motion.div>
         )}
      </AnimatePresence>

      {/* Mobile Bottom Navigation Bar */}
      <div className="md:hidden fixed bottom-0 left-0 right-0 z-[35] bg-white border-t border-gray-200 flex items-center justify-between pb-4 pt-2 px-6 shadow-[0_-10px_30px_-10px_rgba(0,0,0,0.1)]">
         <button onClick={() => setCurrentIndex(Math.max(0, currentIndex - 1))} disabled={currentIndex === 0} className="p-3 text-gray-500 hover:bg-gray-50 rounded-full transition-colors disabled:opacity-30">
            <ChevronRight size={26} />
         </button>
         
         <button onClick={() => {
            quitExam();
         }} className="flex flex-col items-center p-2 text-gray-400 hover:text-[#D4AF37] transition-colors rounded-xl">
            <LayoutList size={22} />
            <span className="text-[10px] font-bold mt-1">البنوك</span>
         </button>

         <button onClick={() => setIsChatOpen(true)} className="relative flex flex-col items-center p-2 text-white bg-gradient-to-tr from-[#D4AF37] to-[#C5A059] rounded-2xl shadow-lg -mt-10 border-[4px] border-[#F8F9FA] hover:scale-105 transition-transform">
            <Bot size={28} className="m-1.5" />
         </button>

         <button onClick={() => setShowSettings(true)} className="flex flex-col items-center p-2 text-gray-400 hover:text-[#D4AF37] transition-colors rounded-xl">
            <Settings size={22} />
            <span className="text-[10px] font-bold mt-1">إعدادات</span>
         </button>
         
         <button onClick={() => setCurrentIndex(Math.min(questions.length - 1, currentIndex + 1))} disabled={currentIndex === questions.length - 1} className="p-3 text-gray-500 hover:bg-gray-50 rounded-full transition-colors disabled:opacity-30">
            <ChevronLeft size={26} />
         </button>
      </div>

      {/* Report Modal */}
      {showReportModal && (
          <div className="fixed inset-0 bg-black/60 backdrop-blur-sm z-[100] flex items-center justify-center p-4">
             <div className="bg-white w-full max-w-lg rounded-2xl shadow-2xl overflow-hidden animate-in zoom-in-95">
                <div className="p-4 border-b border-gray-100 flex justify-between items-center bg-red-50">
                   <h3 className="font-bold text-red-600 flex items-center gap-2"><AlertTriangle size={18} /> تفاصيل البلاغ عن السؤال</h3>
                   <button onClick={() => setShowReportModal(false)} className="text-gray-400 hover:text-gray-700 bg-white p-1 rounded-full"><X size={16} /></button>
                </div>
                <div className="p-6 space-y-4">
                   <div className="bg-gray-50 border border-gray-100 p-4 rounded-xl">
                      <p className="font-bold text-sm text-gray-800 mb-2">نص السؤال:</p>
                      <p className="text-xs text-gray-600 leading-relaxed">{questions[currentIndex]?.text}</p>
                   </div>
                   <div>
                       <label className="block text-sm font-bold text-gray-700 mb-2">ما هي المشكلة بالتحديد؟</label>
                       <textarea 
                           className="w-full bg-white border border-gray-200 rounded-xl p-3 text-sm focus:border-red-500 outline-none h-32 resize-none"
                           placeholder="مثال: الإجابة الصحيحة غير مدرجة، أو هناك خطأ إملائي يغير المعنى..."
                           value={reportReason}
                           onChange={e => setReportReason(e.target.value)}
                       />
                   </div>
                </div>
                <div className="p-4 border-t border-gray-100 flex justify-end gap-3 bg-gray-50">
                    <button onClick={() => setShowReportModal(false)} className="px-5 py-2 rounded-xl text-sm font-bold text-gray-600 hover:bg-gray-200 transition-colors">إلغاء</button>
                    <button 
                        onClick={() => {
                            if (!reportReason.trim()) return alert('الرجاء كتابة تفاصيل المشكلة');
                            const currentQ = questions[currentIndex];
                            addDoc(collection(db, 'reports'), {
                                studentId,
                                studentName: studentData?.fullName || studentData?.name || 'غير معروف',
                                questionId: currentQ?.id || '',
                                bankId: selectedBankId,
                                bankName: banks.find(b => b.id === selectedBankId)?.name || 'غير معروف',
                                questionText: currentQ?.text || '',
                                questionOptions: currentQ?.options || [],
                                questionAnswerIndex: currentQ?.correct || 0,
                                questionAnswerText: currentQ?.options?.[currentQ?.correct] || '',
                                message: reportReason,
                                aiChatHistory: chatMessages.length > 0 ? chatMessages : [],
                                createdAt: serverTimestamp(),
                                isRead: false
                            });
                            alert('تم إرسال بلاغك حول السؤال للإدارة، شكراً لك!');
                            setShowReportModal(false);
                            setReportReason('');
                        }} 
                        className="px-5 py-2 rounded-xl text-sm font-bold bg-red-600 hover:bg-red-700 text-white transition-colors flex items-center gap-2"
                    >
                        <Send size={16} /> إرسال البلاغ
                    </button>
                </div>
             </div>
          </div>
      )}

      {/* Support Chat Floating Button */}
      {!showSupportChat && (
          <button 
             onClick={() => setShowSupportChat(true)}
             className="fixed bottom-24 left-4 sm:bottom-6 sm:left-6 lg:bottom-6 lg:left-6 bg-white text-[#D4AF37] border-2 border-[#D4AF37] rounded-full sm:rounded-2xl flex items-center justify-center shadow-[0_8px_30px_rgb(0,0,0,0.12)] hover:bg-[#D4AF37] hover:text-white transition-all hover:scale-105 z-50 group px-4 py-3 sm:px-5 sm:py-3 gap-2"
             title="تواصل مع الإدارة"
          >
             <Headset size={22} className="animate-pulse" />
             <span className="font-bold text-sm hidden sm:inline-block whitespace-nowrap">كلم الليدر</span>
             <span className="block sm:hidden font-bold text-xs whitespace-nowrap">ليدر</span>
          </button>
      )}

      {/* Support Chat Window */}
      <AnimatePresence>
        {showSupportChat && (
           <motion.div 
             initial={{ opacity: 0, y: 50, scale: 0.9 }}
             animate={{ opacity: 1, y: 0, scale: 1 }}
             exit={{ opacity: 0, y: 50, scale: 0.9 }}
             className="fixed bottom-2 left-2 right-2 sm:bottom-6 sm:left-6 sm:right-auto w-auto sm:w-96 max-w-sm bg-white rounded-2xl shadow-2xl border border-gray-200 z-[60] flex flex-col overflow-hidden h-[500px] max-h-[80vh]"
           >
              {/* Header */}
              <div className="bg-gray-900 text-white p-4 flex justify-between items-center shadow-md">
                 <div className="flex items-center gap-3">
                    <div className="bg-gray-800 p-2 rounded-full"><Headset size={20} className="text-[#D4AF37]"/></div>
                    <div>
                        <h3 className="font-bold text-sm">الدعم الفني والليدرات</h3>
                        <p className="text-[10px] text-gray-400">متواجدون لمساعدتك في حال وجود مشكلة</p>
                    </div>
                 </div>
                 <button onClick={() => setShowSupportChat(false)} className="text-gray-400 hover:text-white transition-colors bg-gray-800 p-1.5 rounded-full"><X size={16} /></button>
              </div>

              {/* Chat Area */}
              <div className="flex-1 bg-[#F8F9FA] p-4 overflow-y-auto flex flex-col gap-3">
                 <div className="text-center my-2">
                    <span className="bg-blue-50 text-blue-700 text-[10px] font-bold px-3 py-1 rounded-full border border-blue-100">بادر بإرسال مشكلتك بوضوح (الاسم، الدفعة، المشكلة)</span>
                 </div>
                 {supportChatMessages.map(msg => (
                    <div key={msg.id} className={`flex ${msg.sender === 'student' ? 'justify-end' : 'justify-start'}`}>
                       <div className={`max-w-[80%] p-3 rounded-2xl text-sm ${msg.sender === 'student' ? 'bg-[#D4AF37] text-white rounded-br-sm shadow-md' : 'bg-white border border-gray-200 text-gray-800 rounded-bl-sm shadow-sm'}`}>
                          <p className="leading-relaxed whitespace-pre-wrap">{msg.message}</p>
                       </div>
                    </div>
                 ))}
                 <div ref={supportChatEndRef} />
              </div>

              {/* Input Area */}
              <div className="p-3 bg-white border-t border-gray-100">
                 <form onSubmit={e => handleSendSupportMessage(e)} className="flex gap-2">
                    <input 
                       value={supportMessage}
                       onChange={e => setSupportMessage(e.target.value)}
                       placeholder="اكتب رسالتك للإدارة هنا..."
                       className="flex-1 bg-gray-50 border border-gray-200 rounded-xl px-4 py-3 text-sm focus:border-[#D4AF37] outline-none"
                    />
                    <button type="submit" disabled={!supportMessage.trim()} className="bg-[#1A1A1A] hover:bg-black text-white w-12 flex items-center justify-center rounded-xl transition-colors disabled:opacity-50"><Send size={18} /></button>
                 </form>
              </div>
           </motion.div>
        )}
      </AnimatePresence>

    </div>
  );
}
