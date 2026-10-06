import "./globals.css";
export const metadata = {
  title: "Giftly Content Studio",
  description: "Content approval, scheduling and website publishing dashboard"
};
export default function RootLayout({children}:{children:React.ReactNode}) {
  return <html lang="en"><body>{children}</body></html>;
}
