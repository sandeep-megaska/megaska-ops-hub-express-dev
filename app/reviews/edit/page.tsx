"use client";
import { useState } from "react";
export default function ReviewEditPage(){const [message,setMessage]=useState("Open this private link from your review email to edit your review.");return <main style={{maxWidth:640,margin:"48px auto",padding:24}}><h1>Edit your review</h1><p>{message}</p><button onClick={()=>setMessage("Your secure edit link is required. Please return to the email we sent you.")}>Continue</button></main>}
