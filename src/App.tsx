/**
 * @license
 * SPDX-License-Identifier: Apache-2.0
 */

import { BrowserRouter, Routes, Route, useNavigate } from 'react-router-dom';
import { useEffect, useState } from 'react';
import Splash from './pages/Splash';
import Login from './pages/Login';
import Exam from './pages/Exam';
import AdminLogin from './pages/AdminLogin';
import AdminDashboard from './pages/AdminDashboard';
import { db, handleFirestoreError, OperationType, isFirebasePlaceholder } from './lib/firebase';
import { doc, onSnapshot } from 'firebase/firestore';
import { Toaster, toast } from 'react-hot-toast';

function AppWrapper({ children }: { children: React.ReactNode }) {
  const [maintenanceMode, setMaintenanceMode] = useState(false);
  const [banned, setBanned] = useState(false);
  const [globalAlert, setGlobalAlert] = useState('');
  const navigate = useNavigate();

  useEffect(() => {
    if (isFirebasePlaceholder) return;
    
    const unsubGlobal = onSnapshot(doc(db, 'admin_system', 'global_settings'), (snap) => {
        if (snap.exists() && snap.data().global_alert_message) {
            setGlobalAlert(snap.data().global_alert_message);
        } else {
            setGlobalAlert('');
        }
    });

    // Check maintenance mode
    const unsubConfig = onSnapshot(doc(db, 'system', 'config'), (docSnap) => {
      if (docSnap.exists() && docSnap.data().maintenanceMode) {
        setMaintenanceMode(true);
      } else {
        setMaintenanceMode(false);
      }
    }, (error) => {
      handleFirestoreError(error, OperationType.GET, 'system/config');
    });

    // Check ban status for current student
    const studentData = localStorage.getItem('tamrediano_student');
    let unsubBan = () => {};
    if (studentData) {
      const studentId = JSON.parse(studentData).id;
      unsubBan = onSnapshot(doc(db, 'strikes', studentId), (docSnap) => {
        if (docSnap.exists() && docSnap.data().banned) {
          setBanned(true);
        } else {
          setBanned(false);
        }
      }, (error) => {
        handleFirestoreError(error, OperationType.GET, `strikes/${studentId}`);
      });
    }

    return () => {
      unsubGlobal();
      unsubConfig();
      unsubBan();
    };
  }, []);

  if (maintenanceMode) {
    return (
      <div className="min-h-screen bg-[#F8F9FA] text-[#1A1A1A] flex flex-col items-center justify-center p-6 text-center font-sans">
        <h1 className="text-4xl font-serif italic text-[#D4AF37] tracking-wider mb-4" style={{ fontFamily: '"Aref Ruqaa", serif' }}>تمريضيانو</h1>
        <div className="bg-white p-8 rounded-3xl border border-gray-200 max-w-md w-full shadow-[0_10px_40px_-10px_rgba(0,0,0,0.1)]">
           <svg className="w-16 h-16 text-[#D4AF37] mx-auto mb-4" fill="none" viewBox="0 0 24 24" stroke="currentColor">
              <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M12 9v2m0 4h.01m-6.938 4h13.856c1.54 0 2.502-1.667 1.732-3L13.732 4c-.77-1.333-2.694-1.333-3.464 0L3.34 16c-.77 1.333.192 3 1.732 3z" />
           </svg>
           <h2 className="text-xl font-bold mb-2">النظام في حالة صيانة</h2>
           <p className="text-gray-500 text-sm leading-relaxed">نقوم حالياً بترقية وتحديث بنوك الأسئلة. نرجو منكم المحاولة لاحقاً. بالتوفيق يا دكاترة!</p>
        </div>
      </div>
    );
  }

  if (banned) {
    return (
      <div className="min-h-screen bg-[#F8F9FA] text-[#1A1A1A] flex flex-col items-center justify-center p-6 text-center font-sans">
        <h1 className="text-4xl font-serif italic text-red-600 tracking-wider mb-4" style={{ fontFamily: '"Aref Ruqaa", serif' }}>تمريضيانو</h1>
        <div className="bg-white p-8 rounded-3xl border border-red-200 max-w-md w-full shadow-[0_10px_40px_-10px_rgba(0,0,0,0.1)]">
           <svg className="w-16 h-16 text-red-600 mx-auto mb-4" fill="none" viewBox="0 0 24 24" stroke="currentColor">
              <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M18.364 18.364A9 9 0 005.636 5.636m12.728 12.728A9 9 0 015.636 5.636m12.728 12.728L5.636 5.636" />
           </svg>
           <h2 className="text-xl font-bold mb-2 text-red-600">تم حظر الحساب</h2>
           <p className="text-gray-500 text-sm leading-relaxed">لقد تم حظر حسابك وجهازك بشكل نهائي من النظام بسبب مخالفة السلوك أو استخدام ألفاظ نابية متكررة.</p>
        </div>
      </div>
    );
  }

  return (
      <div className="relative isolate w-full h-full">
          {globalAlert && (
              <div dir="rtl" className="fixed top-0 left-0 right-0 bg-blue-600 text-white text-center py-2 px-4 shadow-md font-bold text-sm z-[9999] flex justify-center items-center gap-2 animate-pulse">
                  <svg className="w-4 h-4" fill="none" viewBox="0 0 24 24" stroke="currentColor">
                      <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M12 9v2m0 4h.01m-6.938 4h13.856c1.54 0 2.502-1.667 1.732-3L13.732 4c-.77-1.333-2.694-1.333-3.464 0L3.34 16c-.77 1.333.192 3 1.732 3z" />
                  </svg>
                  رسالة من الإدارة: {globalAlert}
              </div>
          )}
          {children}
      </div>
  );
}

export default function App() {
  useEffect(() => {
    // Override window.alert globally to use toast
    const originalAlert = window.alert;
    window.alert = (msg) => {
      if (typeof msg === 'string') {
        if (msg.includes('بنجاح') || msg.includes('تم ') || msg.includes('شكراً')) {
          toast.success(msg, { duration: 3000 });
        } else if (msg.includes('فشل') || msg.includes('خطأ') || msg.includes('تعذر') || msg.includes('غير صحيحة') || msg.includes('الرجاء') || msg.includes('حظر')) {
          toast.error(msg, { duration: 4000 });
        } else {
          toast(msg, { duration: 3000 });
        }
      } else {
        originalAlert(msg);
      }
    };
  }, []);

  if (isFirebasePlaceholder) {
    return (
      <div className="min-h-screen bg-[#F8F9FA] text-[#1A1A1A] flex flex-col items-center justify-center p-6 text-center font-sans tracking-tight" dir="rtl">
        <h1 className="text-4xl font-serif italic text-[#D4AF37] tracking-wider mb-4" style={{ fontFamily: '"Aref Ruqaa", serif' }}>تمريضيانو</h1>
        <div className="bg-white p-8 rounded-3xl border border-[#D4AF37]/30 max-w-lg w-full shadow-[0_10px_40px_-5px_rgba(212,175,55,0.08)]">
           <svg className="w-16 h-16 text-[#D4AF37] mx-auto mb-4 animate-bounce" fill="none" viewBox="0 0 24 24" stroke="currentColor">
              <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={1.5} d="M4 7v10c0 2.21 3.582 4 8 4s8-1.79 8-4V7M4 7c0 2.21 3.582 4 8 4s8-1.79 8-4M4 7c0-2.21 3.582-4 8-4s8 1.79 8 4m0 5c0 2.21-3.582 4-8 4s-8-1.79-8-4" />
           </svg>
           <h2 className="text-xl font-bold mb-3 text-gray-800">تهيئة قاعدة البيانات قيد الانتظار ⏳</h2>
           <p className="text-gray-600 text-sm leading-relaxed mb-6">
             مرحباً بك في <strong className="text-[#D4AF37]">تمريضيانو</strong>! لتفعيل بنوك الأسئلة والنظام بنجاح، يرجى الموافقة على شروط تفعيل Firebase بالضغط على زر <strong>Accept / Approve</strong> في نافذة الدردشة أو في الإشعار الأزرق أعلى منصة AI Studio.
           </p>
           <div className="bg-amber-50 text-amber-900 p-4 rounded-xl text-xs text-right mb-6 border border-amber-100 leading-relaxed font-bold">
             💡 <strong>تنبيه تفعيل الخدمة:</strong> بمجرد نقرك للموافقة على التفعيل في شات الذكاء الاصطناعي، ستقوم المنصة ببناء وتأمين قاعدة بيانات Firestore وتحديث ملف التهيئة تلقائياً. بعد تصفحك للخطوة، اضغط أدناه لإعادة تحميل الصفحة!
           </div>
           <button 
             onClick={() => window.location.reload()} 
             className="w-full bg-[#1A1A1A] hover:bg-black text-white py-3 rounded-xl font-bold text-sm shadow-md transition-all active:scale-95"
           >
             تحديث الصفحة 🔄
           </button>
        </div>
      </div>
    );
  }

  return (
    <BrowserRouter>
      <Toaster position="top-center" toastOptions={{ className: 'font-bold rtl', style: { borderRadius: '12px', padding: '16px', color: '#1A1A1A' } }} />
      <Routes>
        <Route path="/" element={<AppWrapper><Splash /></AppWrapper>} />
        <Route path="/login" element={<AppWrapper><Login /></AppWrapper>} />
        <Route path="/exam" element={<AppWrapper><Exam /></AppWrapper>} />
        <Route path="/admin-login" element={<AdminLogin />} />
        <Route path="/admin-dashboard" element={<AdminDashboard />} />
      </Routes>
    </BrowserRouter>
  );
}
