// The service has no public home page; customers arrive on /s/<token> links
// and the CRM talks to /api/v1.
export default function Home() {
  return (
    <main className="mx-auto max-w-md px-4 py-16 text-center text-slate-600">
      <p>Move Survey service.</p>
    </main>
  );
}
