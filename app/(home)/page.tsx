"use client";

import { useState, useEffect } from "react";
import AOS from "aos";
import "aos/dist/aos.css";
import "../style.css";
import "../mobile.css";

// import Navbar from "../../components/Navbar"; // removed duplicate/incorrect import
import Sidebar from "./SidebarDynamic";
import Home from "../../components/Home";
import Benefits from "../../components/Benefits";
import Features from "../../components/Features";
import Reviews from "../../components/Reviews";
import Pricing from "../../components/Pricing";
import FAQ from "../../components/FAQ";
import CTA from "../../components/CTA";
import { Navbar } from "../../components/Navbar";
import Footer from "../../components/Footer";

export default function FormuLite() {
    const [mobileMenuOpen, setMobileMenuOpen] = useState(false);

    useEffect(() => {
        AOS.init({
            duration: 800,
            easing: "ease-out-cubic",
            offset: 60,
            once: false,
        });
    }, []);

    return (
        <div>
            <div className="desktop-navbar">
                <Navbar />
            </div>
            <div className="mobile-sidebar">
                <Sidebar />
            </div>

            <Home />
            <Benefits />
            <Features />
            <Reviews />
            <Pricing />
            <FAQ />
            <CTA />
            <Footer />
        </div>
    );
}
