import type { Metadata, Viewport } from "next";
import { Geist_Mono, Roboto } from "next/font/google";
import { StatusBarController } from "@/components/pv/status-bar-controller";
import { ThemeModeController } from "@/components/pv/theme-mode-controller";
import { ThemeProvider } from "@/components/theme-provider";
import { APP_ICON_SRC, APP_MANIFEST_SRC } from "@/lib/version";
import "./globals.css";

const roboto = Roboto({
  variable: "--font-sans",
  subsets: ["latin"],
  weight: ["400", "500", "700"],
});

const geistMono = Geist_Mono({
  variable: "--font-geist-mono",
  subsets: ["latin"],
});

export const metadata: Metadata = {
  title: "PV Dash",
  description:
    "Behalte deine Solaranlage im Blick: Erzeugung, Verbrauch, Speicher und Ertrag auf einen Blick – schlicht, intuitiv, für Handy und Tablet.",
  appleWebApp: {
    capable: true,
    statusBarStyle: "black-translucent",
    title: "PV Dash",
  },
  icons: {
    icon: [{ url: APP_ICON_SRC, type: "image/svg+xml" }],
    apple: [{ url: APP_ICON_SRC, type: "image/svg+xml" }],
  },
};

export const viewport: Viewport = {
  width: "device-width",
  initialScale: 1,
  maximumScale: 1,
  viewportFit: "cover",
  themeColor: "#fbf9f5",
};

export default function RootLayout({ children }: LayoutProps<"/">) {
  return (
    <html
      lang="de"
      className={`${roboto.variable} ${geistMono.variable} h-full w-full antialiased`}
      suppressHydrationWarning
    >
      <head>
        {/* Query-String am Manifest, damit Browser/PWA bei Versionsbump neu laden. */}
        <link rel="manifest" href={APP_MANIFEST_SRC} />
      </head>
      <body className="flex min-h-full w-full min-w-0 flex-col overscroll-none">
        <script
          dangerouslySetInnerHTML={{
            __html: `window.__pvDashInstall=null;window.addEventListener("beforeinstallprompt",function(event){event.preventDefault();window.__pvDashInstall=event;window.dispatchEvent(new Event("pv-dash:install-available"));});window.addEventListener("appinstalled",function(){window.__pvDashInstall=null;window.dispatchEvent(new Event("pv-dash:install-available"));});`,
          }}
        />
        <script
          dangerouslySetInnerHTML={{
            __html: `(function(){try{var scheme=localStorage.getItem("pv-dash:color-scheme");var mode=localStorage.getItem("pv-dash:theme-mode");var legacy=localStorage.getItem("theme");if(scheme!=="dark"&&scheme!=="light"){scheme=mode==="dark"||(mode==null&&legacy==="dark")?"dark":"light";}var root=document.documentElement;root.classList.remove("light","dark","dark-flat");root.classList.add(scheme);if(scheme==="dark"&&localStorage.getItem("pv-dash:dark-variant")==="flat"){root.classList.add("dark-flat");}root.style.setProperty("color-scheme",scheme==="dark"?"only dark":"only light");var themeColor=scheme==="dark"?(localStorage.getItem("pv-dash:dark-variant")==="flat"?"#12151c":"#171d2c"):"#fbf9f5";var meta=document.querySelector('meta[name="theme-color"]');if(!meta){meta=document.createElement("meta");meta.setAttribute("name","theme-color");document.head.appendChild(meta);}meta.setAttribute("content",themeColor);meta.removeAttribute("media");}catch(e){}})();`,
          }}
        />
        <ThemeProvider
          attribute="data-theme"
          defaultTheme="light"
          enableSystem={false}
          enableColorScheme={false}
          disableTransitionOnChange
        >
          <ThemeModeController />
          <StatusBarController />
          {children}
        </ThemeProvider>
      </body>
    </html>
  );
}
