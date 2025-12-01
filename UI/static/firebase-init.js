// firebase-init.js  (drop into your project root /static and serve as /static/firebase-init.js)
import { initializeApp } from "https://www.gstatic.com/firebasejs/10.11.0/firebase-app.js";
import { getAuth } from "https://www.gstatic.com/firebasejs/10.11.0/firebase-auth.js";
import { getFirestore } from "https://www.gstatic.com/firebasejs/10.11.0/firebase-firestore.js";
import { getStorage } from "https://www.gstatic.com/firebasejs/10.11.0/firebase-storage.js";

const firebaseConfig = {
  apiKey: "AIzaSyAepgs2kACxXPsnhGTits-r3_6H0JUxMaY",
  authDomain: "health-care-278dd.firebaseapp.com",
  projectId: "health-care-278dd",
  storageBucket: "health-care-278dd.appspot.com",
  messagingSenderId: "115723134686",
  appId: "1:115723134686:web:db1fd221f99946a2b4844f"
};

const app = initializeApp(firebaseConfig);
export const auth = getAuth(app);
export const db = getFirestore(app);
export const storage = getStorage(app);
