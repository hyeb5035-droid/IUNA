export default function HomePage() {
  return (
    <main className="flex min-h-screen items-center justify-center bg-slate-950 px-6 py-24 text-slate-100">
      <div className="max-w-2xl rounded-2xl border border-slate-800 bg-slate-900/70 p-10 shadow-2xl">
        <p className="mb-4 text-sm uppercase tracking-[0.3em] text-cyan-400">Next.js + TypeScript + Tailwind</p>
        <h1 className="text-4xl font-semibold sm:text-5xl">Your app is ready.</h1>
        <p className="mt-4 text-lg text-slate-300">
          This project was created directly in the current folder with the App Router enabled.
        </p>
      </div>
    </main>
  );
}
