import type { Metadata } from "next";
import { Atkinson_Hyperlegible, Bricolage_Grotesque, JetBrains_Mono } from "next/font/google";
import "./globals.css";

// Body face designed by the Braille Institute for low-vision readability.
const atkinson = Atkinson_Hyperlegible({
  variable: "--font-atkinson",
  subsets: ["latin"],
  weight: ["400", "700"],
});

const bricolage = Bricolage_Grotesque({
  variable: "--font-bricolage",
  subsets: ["latin"],
});

const jetbrains = JetBrains_Mono({
  variable: "--font-mono-face",
  subsets: ["latin"],
});

export const metadata: Metadata = {
  title: "Ctrl+V → Access — paste anything, get it in a form you can use",
  description:
    "Paste dense text or an image and instantly get a plain-language version, read-aloud, alt-text, dyslexia mode, and translation. Built for the CTRL+V Hackathon.",
};

// Set theme before paint to avoid a flash.
const themeScript = `
(function(){try{
  var d=document.documentElement;
  var t=localStorage.getItem('cv-theme');
  if(!t){t=window.matchMedia('(prefers-color-scheme: dark)').matches?'dark':'light';}
  d.setAttribute('data-theme',t);
  if(localStorage.getItem('cv-contrast')==='high')d.setAttribute('data-contrast','high');
  if(localStorage.getItem('cv-dyslexia')==='on')d.setAttribute('data-dyslexia','on');
}catch(e){}})();
`;

export default function RootLayout({
  children,
}: Readonly<{ children: React.ReactNode }>) {
  return (
    <html
      lang="en"
      suppressHydrationWarning
      className={`${atkinson.variable} ${bricolage.variable} ${jetbrains.variable}`}
    >
      <head>
        <script dangerouslySetInnerHTML={{ __html: themeScript }} />
      </head>
      <body>{children}</body>
    </html>
  );
}
