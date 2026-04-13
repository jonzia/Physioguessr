// Firebase configuration
const firebaseConfig = {
  apiKey: "AIzaSyCLH-BPpF4Xlk_Pn9n4ICXQtJe-q1W_BGk",
  authDomain: "neuroguessr-5c0c0.firebaseapp.com",
  projectId: "neuroguessr-5c0c0",
  storageBucket: "neuroguessr-5c0c0.firebasestorage.app",
  messagingSenderId: "1022917583392",
  appId: "1:1022917583392:web:82417f93372bdda5a85245",
  measurementId: "G-L9BPV7MSCW"
};

// Initialize Firebase
firebase.initializeApp(firebaseConfig);
const db = firebase.firestore();