import { useEffect, useState } from 'preact/hooks';
import { signal } from '@preact/signals';
import { passwordProblem } from '../domain/presets';
import { fmtDate, dayKey } from '../domain/util';
import { ApiError, config, loadConfig } from '../store/api';
import { meta } from '../store/meta';
import {
  discardGuest,
  guestWorkspace,
  joinAsCashier,
  login,
  loginGoogle,
  migrateGuestAsNew,
  migrateGuestInto,
  openTenant,
  recover,
  register,
  summarizeGuest,
  type GuestSummary,
  type Me,
  type TenantInfo,
} from '../store/session';
import { GoogleButton, Sheet, TopBar, Turnstile, toast } from '../ui/kit';
import { go } from '../ui/router';
import { exportAllForWorkspace } from './exportAll';

const pendingMe = signal<Me | null>(null);
const recoveryCode = signal<string | null>(null);

function errorText(e: unknown): string {
  if (!(e instanceof ApiError)) return navigator.onLine ? 'Gagal terhubung ke server. Coba lagi.' : 'Tidak ada internet. Masuk/daftar butuh koneksi.';
  switch (e.code) {
    case 'wrong_credentials':
      return 'Email atau password salah.';
    case 'locked':
      return `Terlalu banyak percobaan. Coba lagi setelah ${new Date(Number(e.body.until)).toLocaleTimeString('id-ID', { hour: '2-digit', minute: '2-digit' })}.`;
    case 'turnstile':
      return 'Selesaikan verifikasi “bukan robot” dulu.';
    case 'email_taken':
      return 'Email ini sudah terdaftar. Silakan masuk.';
    case 'email_invalid':
    case 'invalid':
      return 'Isian belum benar, periksa lagi.';
    case 'signup_paused':
      return 'Pendaftaran baru sedang ditutup sementara karena kapasitas penuh. Aplikasi tetap bisa dipakai tanpa daftar.';
    case 'wrong_code':
      return 'Kode pemulihan salah.';
    case 'invalid_code':
      return 'Kode salah atau sudah kedaluwarsa. Minta kode baru ke pemilik.';
    case 'google_invalid':
      return 'Login Google gagal. Coba lagi.';
    case 'rate_limited':
      return 'Terlalu banyak percobaan dari jaringan ini. Tunggu 1 menit lalu coba lagi.';
    default:
      return 'Terjadi kesalahan. Coba lagi.';
  }
}

export async function continueAfterLogin(me: Me | null) {
  if (!me) return;
  const guest = guestWorkspace();
  const summary = guest ? await summarizeGuest() : null;
  const hasData = !!summary && (summary.entries > 0 || summary.contacts > 0 || summary.orders > 0);
  if (guest && hasData) {
    pendingMe.value = me;
    go('/migrate', true);
    return;
  }
  if (guest && me.tenants.filter((t) => t.role === 'owner').length === 0) {
    await migrateGuestAsNew();
    go('/', true);
    return;
  }
  if (guest) await discardGuest();
  if (me.tenants.length === 0) {
    go('/new-business', true);
    return;
  }
  await openTenant(me.tenants[0]);
  go('/', true);
}

function useConfig() {
  useEffect(() => {
    if (!config.value) void loadConfig();
  }, []);
  return config.value;
}

function Shell(props: { title: string; children: preact.ComponentChildren; back?: string | false }) {
  return (
    <div>
      <TopBar title={props.title} backTo={props.back ?? '/'} />
      <div class="page">{props.children}</div>
    </div>
  );
}

function GoogleSection() {
  const cfg = useConfig();
  const [busy, setBusy] = useState(false);
  if (!cfg?.googleClientId) return null;
  return (
    <>
      <div class="stack">
      <GoogleButton
        onCredential={async (c) => {
          if (busy) return;
          setBusy(true);
          try {
            await continueAfterLogin(await loginGoogle(c));
          } catch (e) {
            toast(errorText(e));
          } finally {
            setBusy(false);
          }
        }}
      />
      <div class="hint center">Paling gampang: tidak perlu ingat password.</div>
      </div>
      <div class="or-sep">atau pakai email</div>
    </>
  );
}

export function LoginPage() {
  const cfg = useConfig();
  const [email, setEmail] = useState('');
  const [password, setPassword] = useState('');
  const [turnstile, setTurnstile] = useState<string>();
  const [needCaptcha, setNeedCaptcha] = useState(false);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState('');

  const submit = async (e: Event) => {
    e.preventDefault();
    setBusy(true);
    setError('');
    try {
      await continueAfterLogin(await login(email, password, turnstile));
    } catch (err) {
      if (err instanceof ApiError && err.code === 'turnstile') setNeedCaptcha(true);
      if (err instanceof ApiError && err.code === 'wrong_credentials' && cfg?.turnstileSiteKey) setNeedCaptcha(true);
      setError(errorText(err));
    } finally {
      setBusy(false);
    }
  };

  return (
    <Shell title="Masuk">
      <GoogleSection />
      <form class="form-section" onSubmit={submit}>
        <label class="field">
          Email
          <input class="input" type="email" autoComplete="email" required value={email} onInput={(e) => setEmail(e.currentTarget.value)} />
        </label>
        <label class="field">
          Password
          <input class="input" type="password" autoComplete="current-password" required value={password} onInput={(e) => setPassword(e.currentTarget.value)} />
        </label>
        {needCaptcha && <Turnstile onToken={setTurnstile} />}
        {error && <div class="error-text">{error}</div>}
        <button class="btn primary block large" disabled={busy}>
          {busy ? 'Memeriksa…' : 'Masuk'}
        </button>
      </form>
      <div class="links-row">
        <a href="#/recover">Lupa password?</a>
        <a href="#/register">Belum punya akun? Daftar</a>
      </div>
    </Shell>
  );
}

export function RegisterPage() {
  const cfg = useConfig();
  const [name, setName] = useState(meta.value.user?.name ?? '');
  const [email, setEmail] = useState('');
  const [password, setPassword] = useState('');
  const [turnstile, setTurnstile] = useState<string>();
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState('');
  const guestName = guestWorkspace()?.name ?? '';
  const pwProblem = password ? passwordProblem(password, [guestName, email.split('@')[0]]) : null;

  const submit = async (e: Event) => {
    e.preventDefault();
    if (pwProblem) return;
    setBusy(true);
    setError('');
    try {
      const { me, recoveryCode: code } = await register(name.trim(), email, password, turnstile);
      recoveryCode.value = code;
      pendingMe.value = me;
      go('/recovery-code', true);
    } catch (err) {
      setError(errorText(err));
    } finally {
      setBusy(false);
    }
  };

  return (
    <Shell title="Daftar Gratis">
      {cfg?.signup && cfg.signup !== 'open' && (
        <div class="banner soft amber">Pendaftaran baru sedang ditutup sementara karena kapasitas penuh. Aplikasi tetap bisa dipakai tanpa daftar.</div>
      )}
      {guestWorkspace() && <div class="banner soft blue">Catatan yang sudah ada di HP ini bisa kamu bawa ke akun setelah daftar.</div>}
      <GoogleSection />
      <form class="form-section" onSubmit={submit}>
        <label class="field">
          Nama kamu
          <input class="input" required value={name} autoComplete="name" onInput={(e) => setName(e.currentTarget.value)} />
        </label>
        <label class="field">
          Email
          <input class="input" type="email" required value={email} autoComplete="email" onInput={(e) => setEmail(e.currentTarget.value)} />
        </label>
        <label class="field">
          Password (minimal 8 karakter)
          <input class="input" type="password" required value={password} autoComplete="new-password" onInput={(e) => setPassword(e.currentTarget.value)} />
        </label>
        {pwProblem && <div class="error-text">{pwProblem}</div>}
        <div class="hint">
          Kami tidak mengirim email apa pun. Setelah daftar kamu akan dapat <b>kode pemulihan</b> untuk jaga-jaga kalau lupa password.
        </div>
        <Turnstile onToken={setTurnstile} />
        {error && <div class="error-text">{error}</div>}
        <button class="btn primary block large" disabled={busy || !!pwProblem || !name.trim()}>
          {busy ? 'Mendaftarkan… (beberapa detik)' : 'Daftar'}
        </button>
      </form>
      <div class="links-row">
        <a href="#/login">Sudah punya akun? Masuk</a>
      </div>
    </Shell>
  );
}

function codeImage(code: string, label: string): Promise<Blob | null> {
  const c = document.createElement('canvas');
  c.width = 900;
  c.height = 480;
  const g = c.getContext('2d')!;
  g.fillStyle = '#ffffff';
  g.fillRect(0, 0, c.width, c.height);
  g.fillStyle = '#17201b';
  g.font = 'bold 44px system-ui, sans-serif';
  g.fillText('BukuLapak · Kode Pemulihan', 50, 90);
  g.font = '28px system-ui, sans-serif';
  g.fillText(label, 50, 140);
  g.font = 'bold 84px ui-monospace, Menlo, monospace';
  g.fillText(code, 50, 290);
  g.font = '26px system-ui, sans-serif';
  g.fillStyle = '#5b6660';
  g.fillText('Simpan baik-baik. Dipakai kalau lupa password.', 50, 380);
  g.fillText(`Dibuat ${new Date().toLocaleDateString('id-ID')}`, 50, 425);
  return new Promise((r) => c.toBlob(r, 'image/png'));
}

export function RecoveryCodeView(props: { code: string; email: string; onDone: () => void }) {
  const [saved, setSaved] = useState(false);
  return (
    <div class="card stack">
      <h2>Simpan kode pemulihan</h2>
      <p class="small">
        Kalau lupa password, kode ini satu-satunya cara masuk tanpa HP ini. Kode hanya ditampilkan <b>sekali</b>.
      </p>
      <div class="code-box">{props.code}</div>
      <div class="btn-pair">
        <button
          class="btn"
          onClick={async () => {
            const blob = await codeImage(props.code, props.email);
            if (!blob) return;
            const a = document.createElement('a');
            a.href = URL.createObjectURL(blob);
            a.download = 'kode-pemulihan-bukulapak.png';
            a.click();
            setSaved(true);
          }}
        >
          Simpan ke Galeri
        </button>
        <a
          class="btn"
          target="_blank"
          rel="noopener"
          href={`https://wa.me/?text=${encodeURIComponent(`Kode pemulihan BukuLapak (${props.email}): ${props.code}\nJangan bagikan ke orang lain.`)}`}
          onClick={() => setSaved(true)}
        >
          Kirim ke WA saya
        </a>
      </div>
      <label class="check-row">
        <input type="checkbox" class="check" checked={saved} onChange={(e) => setSaved(e.currentTarget.checked)} />
        Sudah saya simpan
      </label>
      <button class="btn primary block large" disabled={!saved} onClick={props.onDone}>
        Lanjut
      </button>
    </div>
  );
}

export function RecoveryCodePage() {
  const code = recoveryCode.value;
  if (!code) {
    go('/', true);
    return null;
  }
  return (
    <Shell title="Kode Pemulihan" back={false}>
      <RecoveryCodeView
        code={code}
        email={meta.value.user?.email ?? ''}
        onDone={async () => {
          recoveryCode.value = null;
          await continueAfterLogin(pendingMe.value);
        }}
      />
    </Shell>
  );
}

export function RecoverPage() {
  const cfg = useConfig();
  const [email, setEmail] = useState('');
  const [code, setCode] = useState('');
  const [password, setPassword] = useState('');
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState('');
  const pwProblem = password ? passwordProblem(password, [email.split('@')[0]]) : null;
  const adminWa = cfg?.adminWa;

  const submit = async (e: Event) => {
    e.preventDefault();
    if (pwProblem) return;
    setBusy(true);
    setError('');
    try {
      const { me, recoveryCode: next } = await recover(email, code, password);
      recoveryCode.value = next;
      pendingMe.value = me;
      go('/recovery-code', true);
    } catch (err) {
      setError(errorText(err));
    } finally {
      setBusy(false);
    }
  };

  return (
    <Shell title="Lupa Password" back="/login">
      <div class="card stack">
        <h3>1. Masih login di HP lain?</h3>
        <p class="small muted">Buka BukuLapak di HP tersebut → Lainnya → Akun & Keamanan → Ganti Password. Tidak perlu password lama.</p>
      </div>
      <div class="card stack">
        <h3>2. Pakai Google?</h3>
        <p class="small muted">Kalau akunmu sudah ditautkan ke Google, cukup masuk dengan Google.</p>
        <a class="btn" href="#/login">
          Masuk dengan Google
        </a>
      </div>
      <form class="card stack" onSubmit={submit}>
        <h3>3. Pakai kode pemulihan</h3>
        <label class="field">
          Email
          <input class="input" type="email" required value={email} onInput={(e) => setEmail(e.currentTarget.value)} />
        </label>
        <label class="field">
          Kode pemulihan
          <input class="input" required value={code} placeholder="XXXX-XXXX-XXXX" autoCapitalize="characters" onInput={(e) => setCode(e.currentTarget.value)} />
        </label>
        <label class="field">
          Password baru
          <input class="input" type="password" required value={password} autoComplete="new-password" onInput={(e) => setPassword(e.currentTarget.value)} />
        </label>
        {pwProblem && <div class="error-text">{pwProblem}</div>}
        {error && <div class="error-text">{error}</div>}
        <button class="btn primary block large" disabled={busy || !!pwProblem}>
          {busy ? 'Memeriksa…' : 'Ganti password & masuk'}
        </button>
      </form>
      <div class="card stack">
        <h3>4. Semua cara di atas tidak bisa?</h3>
        <p class="small muted">
          Hubungi admin lewat WhatsApp. Kami akan menanyakan beberapa hal tentang usahamu (nama usaha, perkiraan saldo, pelanggan terakhir yang dicatat) untuk memastikan itu memang kamu.
        </p>
        {adminWa ? (
          <a class="btn" target="_blank" rel="noopener" href={`https://wa.me/${adminWa}?text=${encodeURIComponent(`Halo admin BukuLapak, saya lupa password akun ${email || '(email saya)'}. Mohon bantuannya.`)}`}>
            Chat admin di WhatsApp
          </a>
        ) : (
          <div class="hint">Nomor admin belum diatur.</div>
        )}
      </div>
    </Shell>
  );
}

export function JoinPage() {
  useConfig();
  const [code, setCode] = useState('');
  const [label, setLabel] = useState('');
  const [turnstile, setTurnstile] = useState<string>();
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState('');
  const submit = async (e: Event) => {
    e.preventDefault();
    setBusy(true);
    setError('');
    try {
      await joinAsCashier(code, label.trim() || 'Kasir', turnstile);
      toast('HP ini terdaftar sebagai kasir');
      go('/', true);
    } catch (err) {
      setError(errorText(err));
    } finally {
      setBusy(false);
    }
  };
  return (
    <Shell title="Masuk sebagai Kasir">
      <form class="card stack" onSubmit={submit}>
        <p class="small">
          Minta <b>kode 6 angka</b> ke pemilik usaha (menu Lainnya → Kasir & Perangkat). Kode berlaku 10 menit.
        </p>
        <label class="field">
          Kode dari pemilik
          <input class="input code" inputMode="numeric" maxLength={6} required value={code} onInput={(e) => setCode(e.currentTarget.value.replace(/\D/g, ''))} />
        </label>
        <label class="field">
          Nama kasir
          <input class="input" required value={label} placeholder="cth. Rina" onInput={(e) => setLabel(e.currentTarget.value)} />
        </label>
        <Turnstile onToken={setTurnstile} />
        {error && <div class="error-text">{error}</div>}
        <button class="btn primary block large" disabled={busy || code.length !== 6}>
          {busy ? 'Memeriksa…' : 'Masuk'}
        </button>
      </form>
    </Shell>
  );
}

export function MigratePage() {
  const me = pendingMe.value;
  const [summary, setSummary] = useState<GuestSummary | null>(null);
  const [busy, setBusy] = useState(false);
  const [confirmStep, setConfirmStep] = useState(0);
  const [target, setTarget] = useState<TenantInfo | 'new' | 'discard'>('new');
  useEffect(() => {
    void summarizeGuest().then(setSummary);
  }, []);
  if (!me) {
    go('/', true);
    return null;
  }
  const owned = me.tenants.filter((t) => t.role === 'owner');
  const tz = 'WIB' as const;

  const run = async () => {
    setBusy(true);
    try {
      if (target === 'new') await migrateGuestAsNew();
      else if (target === 'discard') {
        await discardGuest();
        if (me.tenants.length) await openTenant(me.tenants[0]);
        else return go('/new-business', true);
      } else await migrateGuestInto(target);
      pendingMe.value = null;
      go('/', true);
    } catch (e) {
      toast(errorText(e));
    } finally {
      setBusy(false);
    }
  };

  return (
    <Shell title="Bawa data lama?" back={false}>
      <div class="card stack">
        <h2>Bawa data yang sudah kamu catat?</h2>
        {summary ? (
          <table class="table">
            <tbody>
              <tr>
                <td class="muted">Usaha</td>
                <td>{summary.name}</td>
              </tr>
              <tr>
                <td class="muted">Transaksi</td>
                <td>{summary.entries.toLocaleString('id-ID')}</td>
              </tr>
              {summary.first && (
                <tr>
                  <td class="muted">Periode</td>
                  <td>
                    {fmtDate(dayKey(summary.first, tz))} – {fmtDate(dayKey(summary.last!, tz))}
                  </td>
                </tr>
              )}
              <tr>
                <td class="muted">Kontak / pesanan</td>
                <td>
                  {summary.contacts} / {summary.orders}
                </td>
              </tr>
            </tbody>
          </table>
        ) : (
          <div class="small muted">Menghitung…</div>
        )}
      </div>
      <div class="card stack">
        {owned.length === 0 ? (
          <>
            <button class={`chip option ${target === 'new' ? 'on' : ''}`} onClick={() => setTarget('new')}>
              Ya, bawa semua (disarankan)
            </button>
            <button class={`chip option ${target === 'discard' ? 'on' : ''}`} onClick={() => setTarget('discard')}>
              Mulai dari kosong
            </button>
          </>
        ) : (
          <>
            <button class={`chip option ${target === 'new' ? 'on' : ''}`} onClick={() => setTarget('new')}>
              Jadikan usaha baru (paling aman)
            </button>
            {owned.map((t) => (
              <button key={t.id} class={`chip option ${target !== 'new' && target !== 'discard' && target.id === t.id ? 'on' : ''}`} onClick={() => setTarget(t)}>
                Gabung ke “{t.name}”
              </button>
            ))}
            <button class={`chip option ${target === 'discard' ? 'on' : ''}`} onClick={() => setTarget('discard')}>
              Jangan bawa
            </button>
          </>
        )}
        {typeof target === 'object' && (
          <div class="hint">
            Akun uang & kategori dengan nama sama akan disatukan. Saldo awal dari data lama tidak ikut supaya saldo tidak dobel. Cek saldonya di Pengaturan → Akun Uang setelah selesai.
          </div>
        )}
        <div class="hint">Data di HP ini baru dihapus setelah semua berhasil terkirim ke server.</div>
        <button class="btn primary block large" disabled={busy} onClick={() => (target === 'discard' ? setConfirmStep(1) : run())}>
          {busy ? 'Memproses…' : 'Lanjut'}
        </button>
      </div>
      {confirmStep > 0 && (
        <Sheet title={confirmStep === 1 ? 'Hapus data lama?' : 'Yakin? Tidak bisa dibatalkan'} onClose={() => setConfirmStep(0)}>
          <p class="small">
            {confirmStep === 1
              ? `${summary?.entries ?? 0} transaksi di HP ini akan dihapus. Mau ekspor ke Excel dulu?`
              : 'Data lama akan dihapus permanen dari HP ini.'}
          </p>
          {confirmStep === 1 && (
            <button class="btn block" onClick={() => void exportAllForWorkspace(guestWorkspace()!.id)}>
              Ekspor dulu ke Excel
            </button>
          )}
          <button class="btn red block" disabled={busy} onClick={() => (confirmStep === 1 ? setConfirmStep(2) : run())}>
            {confirmStep === 1 ? 'Lanjut hapus' : 'Ya, hapus permanen'}
          </button>
        </Sheet>
      )}
    </Shell>
  );
}
