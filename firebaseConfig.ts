import { initializeApp } from "firebase/app";
// TODO: Add SDKs for Firebase products that you want to use
// https://firebase.google.com/docs/web/setup#available-libraries

// Your web app's Firebase configuration
// For Firebase JS SDK v7.20.0 and later, measurementId is optional
const firebaseConfig = {
    apiKey: "AIzaSyDrxZaYCCy-jb8jmbCNVAjnoL6Ks866WLM",
    authDomain: "formulite-5b963.firebaseapp.com",
    projectId: "formulite-5b963",
    // Use the default appspot.com bucket name (was incorrect and caused CORS/requests to fail)
    storageBucket: "formulite-5b963.appspot.com",
    messagingSenderId: "1085362007744",
    appId: "1:1085362007744:web:015d3358b42fc4a58ac725",
    measurementId: "G-J2W1LZXDV2",
};

// Initialize Firebase
export const app = initializeApp(firebaseConfig);
