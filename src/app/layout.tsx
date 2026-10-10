import type { Metadata, Viewport } from "next";
import { Geist_Mono, Roboto } from "next/font/google";
import { ThemeModeController } from "@/components/pv/theme-mode-controller";
import { ThemeProvider } from "@/components/theme-provider";
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
  manifest: "/manifest.webmanifest",
  appleWebApp: {
    capable: true,
    statusBarStyle: "default",
    title: "PV Dash",
  },
  icons: {
    icon: "/icon.svg",
    apple: "/icon.svg",
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
      <body className="flex min-h-full w-full min-w-0 flex-col overscroll-none">
        <script
          dangerouslySetInnerHTML={{
            __html: `(function(){try{var scheme=localStorage.getItem("pv-dash:color-scheme");var mode=localStorage.getItem("pv-dash:theme-mode");var legacy=localStorage.getItem("theme");if(scheme!=="dark"&&scheme!=="light"){scheme=mode==="dark"||(mode==null&&legacy==="dark")?"dark":"light";}var root=document.documentElement;root.classList.remove("light","dark");root.classList.add(scheme);root.style.setProperty("color-scheme",scheme==="dark"?"only dark":"only light");}catch(e){}})();`,
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
          {children}
        </ThemeProvider>
      </body>
    </html>
  );
}
