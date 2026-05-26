import { useState, useEffect, useRef } from 'react';
import { useNavigate } from 'react-router-dom';
import { motion, AnimatePresence } from 'motion/react';
import fuzzysort from 'fuzzysort';
import { MessageCircle, Send, X, Headset } from 'lucide-react';
import { db, handleFirestoreError, OperationType } from '@/src/lib/firebase';
import { collection, getDocs, getDoc, setDoc, doc, Timestamp, addDoc, query, where, orderBy, onSnapshot, serverTimestamp } from 'firebase/firestore';
import { useAuth } from '../context/AuthContext';

const ADMINS = ["عمرو كارم محمود موسى", "محمد عبد الجواد", "محمد فكري", "محمود", "عمرو كارم محمود"];
const MASTER_PASS = "122131";

const FLOATING_ITEMS = ['1', '0', '🔒', '💡', '📝', '✓', '8', '3', '📚', '🧑‍⚕️', '💉', '⭐', '4', '7', '💊', '🩺'];

function FloatingBackground() {
  return (
    <div className="fixed inset-0 overflow-hidden pointer-events-none z-0 bg-gradient-to-br from-[#F8F9FA] to-[#E9ECEF]">
      {Array.from({ length: 25 }).map((_, i) => {
        const left = `${Math.random() * 100}%`;
        const top = `${Math.random() * 100}%`;
        const duration = Math.random() * 10 + 8;
        const delay = Math.random() * 5;
        const item = FLOATING_ITEMS[i % FLOATING_ITEMS.length];
        return (
          <motion.div
            key={i}
            className="absolute text-4xl text-gray-300/40 select-none drop-shadow-sm"
            style={{ left, top }}
            animate={{
              y: [0, -100, 0],
              opacity: [0, 0.7, 0],
              scale: [0.6, 1.2, 0.6],
            }}
            transition={{
              duration,
              repeat: Infinity,
              delay,
              ease: "easeInOut"
            }}
            aria-hidden="true"
          >
            {item}
          </motion.div>
        );
      })}
    </div>
  );
}

export default function Login() {
  const navigate = useNavigate();
  const { loginAdmin, loginStudent, studentData } = useAuth();
  const [name, setName] = useState('');
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState('');
  const [isAdminMode, setIsAdminMode] = useState(false);
  const [adminPassword, setAdminPassword] = useState('');
  
  // Cinematic & Auth states
  const [showCinematic, setShowCinematic] = useState(false);
  const [cinematicName, setCinematicName] = useState('');
  const [showUnauthorized, setShowUnauthorized] = useState(false);
  const [showBan, setShowBan] = useState(false);

  // Support Chat State
  const [showSupportChat, setShowSupportChat] = useState(false);
  const [supportMessage, setSupportMessage] = useState('');
  const [chatMessages, setChatMessages] = useState<any[]>([]);

  const [globalSettings, setGlobalSettings] = useState<any>(null);

  useEffect(() => {
    const unsub = onSnapshot(doc(db, 'admin_system', 'global_settings'), (snap) => {
        if (snap.exists()) {
            setGlobalSettings(snap.data());
        }
    });
    return () => unsub();
  }, []);

  const [deviceId, setDeviceId] = useState(() => {
    let id = localStorage.getItem('tamrediano_device_id');
    if (!id) {
        id = 'dev_' + Math.random().toString(36).substring(2, 11);
        localStorage.setItem('tamrediano_device_id', id);
    }
    return id;
  });

  const [pendingLoginStudent, setPendingLoginStudent] = useState<any>(null);
  const [pendingIp, setPendingIp] = useState<string>('');
  const [showDeviceConflict, setShowDeviceConflict] = useState(false);

  useEffect(() => {
    if (studentData) {
      const urlParams = new URLSearchParams(window.location.search);
      const bankId = urlParams.get('bank');
      navigate(bankId ? `/exam?bank=${bankId}` : '/exam', { replace: true });
    }
  }, [navigate, studentData]);

  useEffect(() => {
     if (!deviceId || !showSupportChat) return;
     const q = query(
         collection(db, 'support_chats'),
         where('deviceId', '==', deviceId),
         orderBy('createdAt', 'asc')
     );
     const unsubscribe = onSnapshot(q, (snapshot) => {
         const msgs: any[] = [];
         snapshot.forEach(doc => msgs.push({ id: doc.id, ...doc.data() }));
         setChatMessages(msgs);
     });
     return () => unsubscribe();
  }, [deviceId, showSupportChat]);

  const handleSendSupportMessage = async (e?: React.FormEvent) => {
      e?.preventDefault();
      if (!supportMessage.trim()) return;
      
      const msg = supportMessage;
      setSupportMessage('');
      try {
          await addDoc(collection(db, 'support_chats'), {
              deviceId,
              studentName: name || 'طالب مجهول',
              message: msg,
              sender: 'student',
              createdAt: serverTimestamp()
          });
      } catch (err) {
          console.error("Failed to send message:", err);
      }
  };

  // Helper func to parse user agent
  const getDeviceName = () => {
    let dev = "كمبيوتر/لابتوب";
    const ua = navigator.userAgent.toLowerCase();
    if (ua.includes('android')) dev = "هاتف أندرويد";
    if (ua.includes('ipad') || ua.includes('iphone') || ua.includes('ipod')) dev = "آيفون/آيباد";
    if (ua.includes('windows')) dev = "نظام ويندوز";
    if (ua.includes('macintosh') || ua.includes('mac os')) dev = "ماك بوك / آي ماك";
    return dev;
  };

  const getClientIp = async () => {
      try {
          const res = await fetch('https://api64.ipify.org?format=json');
          return (await res.json()).ip;
      } catch (e) {
          try {
              const res2 = await fetch('https://jsonip.com/');
              return (await res2.json()).ip;
          } catch(e2) {
              return 'unknown';
          }
      }
  };

  const completeStudentLogin = async (student: any, currentIp: string, ips: string[]) => {
      const devInfo = getDeviceName();
      
      if (student.id !== 'dummy1') {
         await setDoc(doc(db, 'users', student.id), { 
           fullName: student.fullName, 
           ips,
           lastLogin: Timestamp.now(),
           currentDeviceId: deviceId,
           deviceInfo: devInfo
         }, { merge: true }).catch(err => {
           console.error("IP update failed", err);
         });
      }

      triggerCinematic(student.fullName, () => {
        loginStudent({
          id: student.id,
          name: student.fullName,
          ip: currentIp
        });
        navigate('/exam', { replace: true });
      });
  };

  const handleConfirmLoginDeviceOverride = async () => {
      if (!pendingLoginStudent) return;
      setShowDeviceConflict(false);
      setLoading(true);
      await completeStudentLogin(pendingLoginStudent, pendingIp, pendingLoginStudent.ips || []);
      setLoading(false);
  };

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    setError('');
    
    if (!name.trim()) return;

    if (isAdminMode) {
      if (adminPassword === MASTER_PASS) {
        if (ADMINS.includes(name)) { // Admin Bypass
          loginAdmin(name);
          navigate('/admin-dashboard', { replace: true });
        } else {
          setError('يرجى التأكد من اسم المشرف أو كلمة المرور');
        }
      } else {
        setError('كلمة المرور غير صحيحة');
      }
      return;
    }

    // Student Fallback (For Testing)
    if (ADMINS.includes(name)) {
        triggerCinematic(name, () => {
          loginStudent({ id: `dummy_${name}`, name: name, ip: 'unknown' });
          const urlParams = new URLSearchParams(window.location.search);
          const bankId = urlParams.get('bank');
          navigate(bankId ? `/exam?bank=${bankId}` : '/exam', { replace: true });
        });
        return;
    }

    setLoading(true);

    try {
      const urlParams = new URLSearchParams(window.location.search);
      const bankId = urlParams.get('bank');

      let currentIp = await getClientIp();

      if (bankId) {
          const bankSnap = await getDoc(doc(db, 'banks', bankId));
          if (!bankSnap.exists()) {
              setError("بنك الأسئلة غير موجود.");
              setLoading(false);
              return;
          }
          const bankData = bankSnap.data();
          if (bankData.autoDeleteAt && bankData.autoDeleteAt < Date.now()) {
              setError("بنك الأسئلة غير موجود.");
              setLoading(false);
              return;
          }
          if (bankData.isPublic === false) {
              const allowedList = bankData.allowedNames ? bankData.allowedNames.split('\n').map((n: string) => n.trim()).filter(Boolean) : [];
              if (!allowedList.includes(name.trim())) {
                  setError("عذراً، هذا الاسم غير مسموح له بدخول هذا البنك.");
                  setShowSupportChat(true); // Open support chat for the student
                  setLoading(false);
                  return;
              }
          }
          
          // Log the entry
          try {
              await addDoc(collection(db, 'bank_entries'), {
                  bankId,
                  bankName: bankData.name,
                  studentName: name,
                  ip: currentIp,
                  createdAt: serverTimestamp()
              });
          } catch(e) {}

          triggerCinematic(name, () => {
              loginStudent({ id: `student_${Date.now()}`, name: name, ip: currentIp });
              navigate(`/exam?bank=${bankId}`, { replace: true });
          });
          return; // Skip global `allowed_students` check
      }

      const studentsRef = collection(db, 'allowed_students');
      const snapshot = await getDocs(studentsRef);
      
      const students: any[] = [];
      const now = Date.now();
      snapshot.forEach(doc => {
        const data = doc.data();
        if (data.expiresAt) {
            const expTime = data.expiresAt.toDate ? data.expiresAt.toDate().getTime() : data.expiresAt;
            if (expTime > now) {
                students.push({ id: doc.id, ...data });
            }
        } else {
            students.push({ id: doc.id, ...data });
        }
      });

      // Also check 'users' collection to maintain backward compatibility
      const usersRef = collection(db, 'users');
      const usersSnap = await getDocs(usersRef);
      usersSnap.forEach(doc => {
          students.push({ id: doc.id, ...doc.data() });
      });

      if (students.length === 0) {
        // Fallback dummy data if nothing exists yet
        students.push({ id: 'dummy1', fullName: 'عمر احمد', ips: [] });
      }

      const results = fuzzysort.go(name, students, { key: 'fullName', threshold: -10000 });
      
      if (results.length > 0 && results[0].score > -1000) {
        const student = results[0].obj;
        
        // Fetch real IP
        let currentIp = await getClientIp();

        const ips = student.ips || [];
        if (!ips.includes(currentIp)) {
          ips.push(currentIp);
        }

        // AUTO-BAN CHECK & STRIKES
        let isBanned = false;
        if (ips.length > 3 || student.banned) isBanned = true;
        
        if (student.id && student.id !== 'dummy1') {
            try {
               const strikeSnap = await getDoc(doc(db, 'strikes', student.id));
               if (strikeSnap.exists() && strikeSnap.data().banned) {
                   isBanned = true;
               }
            } catch(e){}
        }

        if (isBanned) {
          setShowBan(true);
          setLoading(false);
          return;
        }
        if (student.expiresAt) {
          let expiryDate: Date;
          if (student.expiresAt && typeof student.expiresAt.toDate === 'function') {
            expiryDate = student.expiresAt.toDate();
          } else {
            expiryDate = new Date(student.expiresAt);
          }
          if (expiryDate.getTime() <= Date.now()) {
            setError("عذراً، انتهت صلاحية هذا الحساب التجريبي. يرجى التواصل مع الإدارة لتجديد صلاحية دخولك للبنك.");
            setLoading(false);
            return;
          }
        }

        // Removed redundant auto-ban check

        // Device Binding check
        if (student.currentDeviceId && student.currentDeviceId !== deviceId && student.id !== 'dummy1') {
            setPendingLoginStudent(student);
            setPendingIp(currentIp);
            setShowDeviceConflict(true);
            setLoading(false);
            return;
        }

        await completeStudentLogin(student, currentIp, ips);

      } else {
        if (globalSettings?.allow_all_names) {
            let currentIp = await getClientIp();
            const newId = `student_${Date.now()}`;
            try {
                await setDoc(doc(db, 'users', newId), {
                    fullName: name,
                    name: name,
                    ips: [currentIp],
                    lastLogin: serverTimestamp(),
                    lastActive: serverTimestamp(),
                    deviceId: deviceId,
                    currentDeviceId: deviceId,
                    deviceInfo: navigator.userAgent
                });
            } catch(e) {}
            
            triggerCinematic(name, () => {
              loginStudent({ id: newId, name: name, ip: currentIp });
              const currentBank = (new URLSearchParams(window.location.search)).get('bank');
              navigate(currentBank ? `/exam?bank=${currentBank}` : '/exam', { replace: true });
            });
            return;
        }
        setShowUnauthorized(true);
      }
    } catch (err) {
      handleFirestoreError(err, OperationType.GET, 'allowed_students');
      setError('حدث خطأ في الاتصال بقاعدة البيانات.');
    }
    setLoading(false);
  };

  const triggerCinematic = (fullName: string, callback: () => void) => {
     setCinematicName(fullName);
     setShowCinematic(true);
     setTimeout(() => {
        callback();
     }, 2500); // Cinematic duration
  };

  const handleAccessRequest = async () => {
    setLoading(true);
    try {
        let currentIp = await getClientIp();

        await setDoc(doc(collection(db, 'accessRequests')), {
            requestedName: name,
            ipAddress: currentIp,
            status: 'pending',
            createdAt: Timestamp.now() // Use the actual message logic here or redirect to a chat
        });

        alert('تم إرسال طلبك لللإدارة.');
        setShowUnauthorized(false);
        setName('');
    } catch (err) {
        handleFirestoreError(err, OperationType.CREATE, 'accessRequests');
        setError('حدث خطأ أثناء إرسال الطلب.');
    }
    setLoading(false);
  };

  if (showCinematic) {
    return (
      <div className="fixed inset-0 bg-[#F8F9FA] flex flex-col items-center justify-center z-50">
         <motion.div 
            initial={{ opacity: 0, scale: 0.8, y: 20 }}
            animate={{ opacity: 1, scale: 1, y: 0 }}
            transition={{ duration: 1, ease: 'easeOut' }}
            className="text-center"
         >
            <h1 className="text-7xl font-serif italic text-[#D4AF37] tracking-wider mb-6 drop-shadow-md" style={{ fontFamily: '"Aref Ruqaa", serif' }}>تمريضيانو</h1>
            <motion.p 
              initial={{ opacity: 0 }}
              animate={{ opacity: 1 }}
              transition={{ delay: 0.8, duration: 1 }}
              className="text-gray-600 text-xl font-bold"
            >
              أهلاً بك، <span className="text-[#D4AF37]">{cinematicName}</span>...
            </motion.p>
         </motion.div>
      </div>
    );
  }

  if (showBan) {
    return (
      <div className="min-h-screen flex flex-col items-center justify-center bg-[#F8F9FA] text-[#1A1A1A] p-6 font-sans rtl relative">
         <motion.div initial={{ opacity: 0, scale: 0.95 }} animate={{ opacity: 1, scale: 1 }} className="w-full max-w-md bg-white rounded-3xl shadow-2xl p-8 border border-red-100 text-center z-10">
            <div className="w-20 h-20 bg-red-50 rounded-full flex items-center justify-center mx-auto mb-6">
               <span className="text-red-500 text-4xl">🚫</span>
            </div>
            <h2 className="text-2xl font-bold text-red-600 mb-4">حسابك محظور</h2>
            <p className="text-gray-600 mb-8 leading-relaxed font-medium">تم إيقاف حسابك لتجاوز الحد المسموح من الأجهزة (أكثر من 3) أو لمخالفة القواعد. يرجى التواصل مع الإدارة.</p>
            <div className="flex flex-col gap-3">
               <button onClick={() => setShowSupportChat(true)} className="w-full bg-[#1A1A1A] text-white font-bold py-3 rounded-xl hover:bg-black transition-colors flex items-center justify-center gap-2">
                 <MessageCircle size={18} /> تواصل مع الإدارة الآن
               </button>
               <button onClick={() => setShowBan(false)} className="bg-gray-100 text-gray-700 font-bold py-3 px-6 rounded-xl hover:bg-gray-200 transition-all">عودة للخلف</button>
            </div>
         </motion.div>

         {/* Support Chat Window */}
         <AnimatePresence>
           {showSupportChat && (
              <motion.div 
                initial={{ opacity: 0, y: 50, scale: 0.9 }}
                animate={{ opacity: 1, y: 0, scale: 1 }}
                exit={{ opacity: 0, y: 50, scale: 0.9 }}
                className="fixed bottom-6 right-6 w-full max-w-sm sm:w-96 bg-white rounded-2xl shadow-2xl border border-gray-200 z-50 flex flex-col overflow-hidden h-[500px] max-h-[80vh]"
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
                    {chatMessages.map(msg => (
                       <div key={msg.id} className={`flex ${msg.sender === 'student' ? 'justify-end' : 'justify-start'}`}>
                          <div className={`max-w-[80%] p-3 rounded-2xl text-sm ${msg.sender === 'student' ? 'bg-[#D4AF37] text-white rounded-br-sm shadow-md' : 'bg-white border border-gray-200 text-gray-800 rounded-bl-sm shadow-sm'}`}>
                             <p className="leading-relaxed">{msg.message}</p>
                          </div>
                       </div>
                    ))}
                 </div>

                 {/* Input Area */}
                 <div className="p-3 bg-white border-t border-gray-100">
                    <form onSubmit={handleSendSupportMessage} className="flex gap-2">
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

  if (showUnauthorized) {
    return (
      <div className="min-h-screen flex flex-col items-center justify-center bg-[#F8F9FA] text-[#1A1A1A] p-6 font-sans rtl">
         <motion.div initial={{ opacity: 0, scale: 0.95 }} animate={{ opacity: 1, scale: 1 }} className="w-full max-w-md bg-white rounded-3xl shadow-2xl p-8 border border-gray-100 text-center">
            <h2 className="text-3xl font-serif text-gray-800 mb-4" style={{ fontFamily: '"Aref Ruqaa", serif' }}>عذراً، غير مصرح لك!</h2>
            <p className="text-gray-600 mb-8 leading-relaxed font-medium">الاسم <span className="font-bold text-[#D4AF37]">{name}</span> غير مسجل في قوائم الدفعة المعتمدة للوصول لهذه المنصة.</p>
            <div className="flex flex-col gap-3">
               <button onClick={() => { setShowUnauthorized(false); setShowSupportChat(true); }} className="w-full bg-[#D4AF37] text-white font-bold py-4 rounded-xl shadow-lg hover:shadow-xl transition-all">كلم الليدرات (تواصل مع الإدارة)</button>
               <button onClick={() => setShowUnauthorized(false)} className="w-full bg-white border border-gray-200 text-gray-600 font-bold py-4 rounded-xl hover:bg-gray-50 transition-all">رجوع</button>
            </div>
         </motion.div>
      </div>
    );
  }

  return (
    <div className="min-h-screen flex flex-col items-center justify-center bg-[#F8F9FA] text-[#1A1A1A] p-6 font-sans overflow-hidden relative" dir="rtl">
      <FloatingBackground />
      <motion.div 
        initial={{ opacity: 0, scale: 0.85, y: 40 }}
        animate={{ opacity: 1, scale: 1, y: 0 }}
        transition={{ duration: 0.8, ease: [0.16, 1, 0.3, 1] }}
        className="w-full max-w-md bg-white/95 backdrop-blur-xl rounded-3xl shadow-[0_20px_60px_-15px_rgba(0,0,0,0.1)] p-8 border border-white/50 z-10 relative"
      >
        <div className="text-center mb-8">
          <h1 className="text-5xl font-serif italic text-[#D4AF37] tracking-wider mb-2 select-none drop-shadow-sm" style={{ fontFamily: '"Aref Ruqaa", serif' }}>تمريضيانو</h1>
          <p className="text-xs uppercase tracking-[0.2em] text-gray-400 font-bold">بوابة الدخول الموحدة</p>
        </div>

        <form onSubmit={handleSubmit} className="space-y-5">
          <div className="relative">
            <div className="absolute inset-y-0 right-0 pr-4 flex items-center pointer-events-none text-xl opacity-80">
               👤
            </div>
            <input
              type="text"
              value={name}
              onChange={(e) => setName(e.target.value)}
              placeholder={isAdminMode ? "الاسم الثلاثي للمشرف" : "الاسم الثلاثي للطالب"}
              className="w-full pr-12 pl-5 py-4 rounded-xl border border-gray-200 bg-gray-50/50 placeholder-gray-400 focus:outline-none focus:border-[#D4AF37] focus:ring-2 focus:ring-[#D4AF37]/30 text-gray-900 transition-all text-right text-sm font-bold shadow-sm"
              required
            />
          </div>

          <AnimatePresence>
            {isAdminMode && (
              <motion.div
                initial={{ opacity: 0, height: 0, y: -10 }}
                animate={{ opacity: 1, height: 'auto', y: 0 }}
                exit={{ opacity: 0, height: 0, y: -10 }}
                transition={{ duration: 0.3 }}
                className="overflow-hidden"
              >
                <div className="pt-2">
                  <div className="relative">
                    <div className="absolute inset-y-0 right-0 pr-4 flex items-center pointer-events-none text-xl opacity-80">
                      🔒
                    </div>
                    <input
                      type="password"
                      value={adminPassword}
                      onChange={(e) => setAdminPassword(e.target.value)}
                      placeholder="كلمة المرور للإدارة"
                      className="w-full pr-12 pl-5 py-4 rounded-xl border border-gray-200 bg-gray-50/50 placeholder-gray-400 focus:outline-none focus:border-[#D4AF37] focus:ring-2 focus:ring-[#D4AF37]/30 text-gray-900 transition-all text-center text-sm font-mono tracking-widest shadow-sm"
                      required={isAdminMode}
                    />
                  </div>
                </div>
              </motion.div>
            )}
          </AnimatePresence>

          {error && <p className="text-red-600 text-xs text-center font-bold py-2 bg-red-50 rounded-lg border border-red-100">{error}</p>}

          <button
            type="submit"
            disabled={loading || !name.trim()}
            className="w-full bg-gradient-to-r from-[#D4AF37] to-[#B3932F] text-white text-sm font-bold py-4 rounded-xl shadow-[0_8px_20px_-6px_rgba(212,175,55,0.4)] hover:shadow-[0_12px_24px_-6px_rgba(212,175,55,0.6)] hover:-translate-y-0.5 transition-all duration-300 disabled:opacity-50 disabled:transform-none mt-4"
          >
            {loading ? 'جاري التحقق...' : (isAdminMode ? 'دخول الإدارة' : 'دخول المنصة')}
          </button>
        </form>

        <div className="mt-8 text-center pt-6 border-t border-gray-100">
           <button 
             onClick={() => setIsAdminMode(!isAdminMode)}
             type="button"
             className="text-xs font-bold text-gray-400 hover:text-[#D4AF37] transition-colors bg-transparent border-none outline-none cursor-pointer select-none flex items-center justify-center mx-auto gap-2"
           >
             {isAdminMode ? 'العودة كطالب' : 'دخول الإدارة'}
           </button>
        </div>

      </motion.div>

      <AnimatePresence>
        {showDeviceConflict && (
           <div className="fixed inset-0 bg-black/60 backdrop-blur-sm flex items-center justify-center p-4 z-50">
             <motion.div 
               initial={{ opacity: 0, scale: 0.95, y: 20 }}
               animate={{ opacity: 1, scale: 1, y: 0 }}
               className="bg-white p-8 rounded-3xl max-w-sm w-full text-center border-2 border-orange-200 shadow-2xl space-y-6"
             >
               <div className="w-20 h-20 bg-orange-50 rounded-full flex items-center justify-center mx-auto">
                 <svg className="w-10 h-10 text-orange-500" fill="none" viewBox="0 0 24 24" stroke="currentColor">
                   <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M12 9v2m0 4h.01m-6.938 4h13.856c1.54 0 2.502-1.667 1.732-3L13.732 4c-.77-1.333-2.694-1.333-3.464 0L3.34 16c-.77 1.333.192 3 1.732 3z" />
                 </svg>
               </div>
               <div>
                  <h3 className="text-xl font-bold text-gray-900 mb-2">تنبيه: الحساب قيد الاستخدام</h3>
                  <p className="text-sm text-gray-500 leading-relaxed font-medium">الاسم مسجل ومُستخدم في جهاز آخر حالياً. هل تريد تسجيل الخروج من الجهاز الآخر والدخول من هذا الحساب؟</p>
               </div>
               <div className="flex gap-3 pt-2">
                  <button onClick={() => { setShowDeviceConflict(false); setPendingLoginStudent(null); }} className="flex-1 px-4 py-3 bg-gray-100 hover:bg-gray-200 text-gray-700 font-bold rounded-xl transition-colors">إلغاء</button>
                  <button onClick={handleConfirmLoginDeviceOverride} className="flex-1 px-4 py-3 bg-orange-500 hover:bg-orange-600 text-white font-bold rounded-xl shadow-lg shadow-orange-500/30 transition-all">نعم، متأكد</button>
               </div>
             </motion.div>
           </div>
        )}
      </AnimatePresence>

      {/* Support Chat Floating Button */}
      {!showSupportChat && (
          <button 
             onClick={() => setShowSupportChat(true)}
             className="fixed bottom-6 right-6 w-14 h-14 bg-[#D4AF37] text-white rounded-full flex items-center justify-center shadow-2xl hover:bg-[#C5A059] transition-all hover:scale-110 z-50 group hover:shadow-[#D4AF37]/50"
             title="تواصل مع الإدارة"
          >
             <MessageCircle size={28} />
             <span className="absolute -top-10 right-0 bg-gray-900 text-white text-xs font-bold px-3 py-1.5 rounded-lg opacity-0 group-hover:opacity-100 transition-opacity whitespace-nowrap shadow-lg">واجهت مشكلة؟ المحادثة مع الليدرات</span>
          </button>
      )}

      {/* Support Chat Window */}
      <AnimatePresence>
        {showSupportChat && (
           <motion.div 
             initial={{ opacity: 0, y: 50, scale: 0.9 }}
             animate={{ opacity: 1, y: 0, scale: 1 }}
             exit={{ opacity: 0, y: 50, scale: 0.9 }}
             className="fixed bottom-6 right-6 w-full max-w-sm sm:w-96 bg-white rounded-2xl shadow-2xl border border-gray-200 z-50 flex flex-col overflow-hidden h-[500px] max-h-[80vh]"
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
                 {chatMessages.map(msg => (
                    <div key={msg.id} className={`flex ${msg.sender === 'student' ? 'justify-end' : 'justify-start'}`}>
                       <div className={`max-w-[80%] p-3 rounded-2xl text-sm ${msg.sender === 'student' ? 'bg-[#D4AF37] text-white rounded-br-sm shadow-md' : 'bg-white border border-gray-200 text-gray-800 rounded-bl-sm shadow-sm'}`}>
                          <p className="leading-relaxed">{msg.message}</p>
                       </div>
                    </div>
                 ))}
              </div>

              {/* Input Area */}
              <div className="p-3 bg-white border-t border-gray-100">
                 <form onSubmit={handleSendSupportMessage} className="flex gap-2">
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
