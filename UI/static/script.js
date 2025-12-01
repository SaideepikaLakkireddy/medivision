// /static/js/script.js
// Final script.js (module)
// Expects /static/firebase-init.js to export { auth, db, storage }

import { auth, db, storage } from "/static/firebase-init.js";

import {
  createUserWithEmailAndPassword,
  signInWithEmailAndPassword,
  onAuthStateChanged,
  updateProfile,
  signOut
} from "https://www.gstatic.com/firebasejs/10.11.0/firebase-auth.js";

import {
  doc,
  setDoc,
  getDoc,
  addDoc,
  collection,
  serverTimestamp,
  query,
  orderBy,
  getDocs
} from "https://www.gstatic.com/firebasejs/10.11.0/firebase-firestore.js";

import {
  getDownloadURL,
  ref as storageRef,
  uploadBytes
} from "https://www.gstatic.com/firebasejs/10.11.0/firebase-storage.js";

/* ========== Safe DOM helper ========== */
function safeGet(id) {
  const el = document.getElementById(id);
  if (!el) console.debug(`safeGet: Element with id "${id}" not found`);
  return el;
}

/* ========== Registration ========== */
async function handleRegister(e) {
  e.preventDefault();
  const firstnameEl = safeGet("firstname");
  const lastnameEl = safeGet("lastname");
  const mobilenoEl = safeGet("mobileno");
  const emailEl = safeGet("email");
  const passwordEl = safeGet("password");
  const confirmEl = safeGet("confirmpassword");

  if (!firstnameEl || !lastnameEl || !emailEl || !passwordEl || !confirmEl) {
    return alert("Registration form missing fields. Check IDs.");
  }

  const firstname = firstnameEl.value.trim();
  const lastname = lastnameEl.value.trim();
  const mobileno = mobilenoEl ? mobilenoEl.value.trim() : "";
  const email = emailEl.value.trim();
  const password = passwordEl.value;
  const confirmPassword = confirmEl.value;

  if (!firstname || !lastname || !email || !password) return alert("Please fill all fields.");
  if (password !== confirmPassword) return alert("Passwords do not match.");

  try {
    const userCred = await createUserWithEmailAndPassword(auth, email, password);
    const user = userCred.user;
    await setDoc(doc(db, 'users', user.uid), {
      firstname, lastname, mobileno, email
    });
    await updateProfile(user, { displayName: `${firstname} ${lastname}` });
    window.location.href = "/login.html";
  } catch (err) {
    console.error(err);
    alert("Registration failed: " + (err.message || err));
  }
}

/* ========== Login ========== */
async function handleLoginSubmit(e) {
  e.preventDefault();
  const emailInput = safeGet("loginEmail");
  const passwordInput = safeGet("loginPassword");
  if (!emailInput || !passwordInput) return alert("Login form fields missing.");
  const email = emailInput.value.trim();
  const password = passwordInput.value;
  if (!email || !password) return alert("Enter email and password.");
  try {
    await signInWithEmailAndPassword(auth, email, password);
    window.location.href = "/home.html";
  } catch (err) {
    console.error(err);
    alert("Login failed: " + (err.message || err));
  }
}

/* ========== Logout ========== */
async function handleLogout() {
  try {
    await signOut(auth);
    localStorage.removeItem("user");
    window.location.href = "/login.html";
  } catch (err) {
    console.error(err);
    alert("Logout failed: " + (err.message || err));
  }
}

/* ========== Fetch user profile ========== */
async function fetchUserProfile(uid) {
  try {
    const snap = await getDoc(doc(db, "users", uid));
    return snap.exists() ? snap.data() : null;
  } catch (err) {
    console.error(err);
    return null;
  }
}

/* ========== Upload helper: fetch a server URL and upload blob to Firebase Storage ==========
   - returns downloadURL or null on failure.
   - pathPrefix e.g. `records/skin/` or `records/xray/`
====================================================================== */
async function uploadUrlToStorage(url, destPath) {
  if (!url) return null;
  try {
    const resp = await fetch(url);
    if (!resp.ok) throw new Error("fetch failed " + resp.status);
    const blob = await resp.blob();
    const r = storageRef(storage, destPath);
    await uploadBytes(r, blob);
    return await getDownloadURL(r);
  } catch (err) {
    console.warn("uploadUrlToStorage failed:", err);
    return null;
  }
}

/* ========== Central helper used by result pages
   param shape:
     {
       type: "skin" | "xray" | string,
       single: { label, confidence, confidence_percent, filename, image_url } | null,
       zip: [ { filename, label, confidence, confidence_percent, image_url }, ... ] | null
     }
   This function waits for a logged-in user (via onAuthStateChanged) up to a brief period,
   then uploads any image_url to Firebase Storage (under users/<uid>/predictions/...), then
   writes Firestore docs with createdAt serverTimestamp().
====================================================================== */
export async function savePredictionsFromResult({ type = "unknown", single = null, zip = null }) {
  // wait for authenticated user
  let resolvedUser = null;
  const timeoutMs = 8000;
  const p = new Promise(resolve => {
    const unsub = onAuthStateChanged(auth, u => {
      if (u) {
        unsub();
        resolve(u);
      }
    });
    setTimeout(() => { unsub(); resolve(null); }, timeoutMs);
  });
  resolvedUser = await p;

  if (!resolvedUser) {
    console.debug("savePredictionsFromResult: no logged in user; skipping save.");
    return;
  }

  const uid = resolvedUser.uid;

  // helper to save one item
  async function saveItem(item) {
    try {
      let imageUrl = null;
      const payload = {
        type,
        model: type,
        filename: item.filename || null,
        label: item.label || null,
        // support both confidence (0..1) or confidence_percent (0..100)
        confidence: (typeof item.confidence === "number") ? item.confidence :
                    (typeof item.confidence_percent === "number" ? (item.confidence_percent / 100.0) : null),
        confidence_percent: (typeof item.confidence_percent === "number") ? item.confidence_percent :
                    (typeof item.confidence === "number" ? (item.confidence * 100.0) : null),
        imageUrl: imageUrl,
        createdAt: serverTimestamp(),
        raw: item.raw ?? null,
        notes: item.notes ?? null
      };

      await addDoc(collection(db, "users", uid, "predictions"), payload);
      console.debug("Saved prediction item for", uid, "label=", payload.label);
    } catch (err) {
      console.error("savePredictionsFromResult.saveItem failed:", err);
    }
  }

  if (single) {
    await saveItem(single);
  }

  if (Array.isArray(zip)) {
    for (const it of zip) {
      await saveItem(it);
    }
  }
}

/* ========== DOM wiring (register/login/contact/sidebar) ========== */
document.addEventListener("DOMContentLoaded", () => {
  const registerForm = safeGet("registerForm");
  if (registerForm) registerForm.addEventListener("submit", handleRegister);

  const loginForm = safeGet("loginForm");
  if (loginForm) loginForm.addEventListener("submit", handleLoginSubmit);

  const contactForm = safeGet("contactForm");
  if (contactForm) {
    contactForm.addEventListener("submit", async (e) => {
      e.preventDefault();
      const name = safeGet("name")?.value.trim();
      const email = safeGet("email")?.value.trim();
      const message = safeGet("message")?.value.trim();
      if (!name || !email || !message) return alert("Fill all fields.");
      try {
        await addDoc(collection(db, "contacts"), { name, email, message, createdAt: serverTimestamp() });
        alert("Message sent.");
        contactForm.reset();
      } catch (err) {
        console.error(err);
        alert("Failed to send message: " + (err.message || err));
      }
    });
    const healthBtn = safeGet("healthRecordsBtn");
if (healthBtn) {
  healthBtn.addEventListener("click", () => {
    window.location.href = "/health_records";
  });
}
  }

  // go-predict buttons
  document.querySelectorAll(".go-predict").forEach(btn => {
    btn.addEventListener("click", (e) => {
      e.preventDefault();
      const target = btn.dataset.target || "/prediction.html";
      if (!auth.currentUser) {
        alert("please log in first");
        window.location.href = "/login.html";
      } else {
        window.location.href = target;
      }
    });
  });

  const logoutBtn = safeGet("logoutBtn") || safeGet("sidebarLogout");
  if (logoutBtn) logoutBtn.addEventListener("click", handleLogout);

  // auth listener to update sidebar / login button
  onAuthStateChanged(auth, async (user) => {
    const loginContainer = safeGet("loginBtnContainer");
    const profileIconContainer = safeGet("profileIconContainer");
    const openProfileBtn = safeGet("openProfileBtn");
    const sidebar = safeGet("profileSidebar");
    const overlay = safeGet("sidebarOverlay");
    const sidebarName = safeGet("sidebarName");
    const sidebarEmail = safeGet("sidebarEmail");
    const sidebarMobile = safeGet("sidebarMobile");

    if (user) {
      if (loginContainer) loginContainer.style.display = "none";
      if (profileIconContainer) profileIconContainer.classList.remove("d-none");
    } else {
      if (loginContainer) loginContainer.style.display = "";
      if (profileIconContainer) profileIconContainer.classList.add("d-none");
    }

    if (openProfileBtn && sidebar && overlay) {
      openProfileBtn.onclick = () => {
        sidebar.classList.toggle("active");
        overlay.classList.toggle("active");
      };
      overlay.onclick = () => { sidebar.classList.remove("active"); overlay.classList.remove("active"); };
    }

    if (user && sidebarName && sidebarEmail && sidebarMobile) {
      const profile = await fetchUserProfile(user.uid);
      const fullname = profile ? `${profile.firstname} ${profile.lastname}` : (user.displayName || "User");
      sidebarName.textContent = fullname;
      sidebarEmail.textContent = profile?.email || user.email || "";
      sidebarMobile.textContent = profile?.mobileno ? "Mobile: " + profile.mobileno : "";
      localStorage.setItem("user", JSON.stringify({ uid: user.uid, email: user.email, displayName: fullname }));
    } else if (!user) {
      if (sidebarName) sidebarName.textContent = "User Name";
      if (sidebarEmail) sidebarEmail.textContent = "user@example.com";
      if (sidebarMobile) sidebarMobile.textContent = "";
      localStorage.removeItem("user");
    }
  });
});

/* ========== Helper to fetch recent records (optional utility other pages can import) ========== */
export async function fetchUserPredictions(uid, limit = 200) {
  if (!uid) return [];
  try {
    const colRef = collection(db, "users", uid, "predictions");
    const q = query(colRef, orderBy("createdAt", "desc"));
    const snap = await getDocs(q);
    const rows = [];
    snap.forEach(s => rows.push({ id: s.id, ...s.data() }));
    return rows;
  } catch (err) {
    console.error("fetchUserPredictions error:", err);
    return [];
  }
}
