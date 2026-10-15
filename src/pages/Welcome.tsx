import { useState } from 'preact/hooks';
import { BUSINESS_TYPES, guessTz } from '../domain/presets';
import type { BusinessType, Tz } from '../domain/types';
import { MoneyInput, TopBar, toast } from '../ui/kit';
import { go } from '../ui/router';
import { createGuestWorkspace, createTenantWorkspace } from '../store/session';
import { meta } from '../store/meta';
import { InstallHelp } from '../ui/install';
import { ApiError } from '../store/api';
import { BadgeCheck, WifiOff, Zap } from 'lucide-preact';

export function Welcome() {
  return (
    <div class="welcome">
      <div class="stack loose">
        <span class="app-icon brand-dup" aria-hidden="true">
          B
        </span>
        <div class="stack">
          <h1 class="hero-title">BukuLapak</h1>
          <p class="lead">
            Catat uang masuk & keluar usahamu. Langsung tahu <b>untung berapa</b> dan <b>uangnya ada di mana</b>.
          </p>
        </div>
      </div>
      <ul class="feature-list">
        <li>
          <span class="set-icon green" aria-hidden="true">
            <BadgeCheck size={18} />
          </span>
          Gratis, tanpa iklan
        </li>
        <li>
          <span class="set-icon blue" aria-hidden="true">
            <WifiOff size={18} />
          </span>
          Tetap jalan walau tidak ada sinyal
        </li>
        <li>
          <span class="set-icon orange" aria-hidden="true">
            <Zap size={18} />
          </span>
          Langsung pakai, tidak perlu daftar
        </li>
      </ul>
      <div class="stack">
        <button class="btn green block large" onClick={() => go('/start')}>
          Mulai catat
        </button>
        <div class="links-row">
          <a href="#/login">Sudah punya akun? Masuk</a>
          <a href="#/join">Saya kasir, punya kode</a>
        </div>
      </div>
      <InstallHelp compact />
    </div>
  );
}

export function Onboarding(props: { mode: 'guest' | 'tenant' }) {
  const [step, setStep] = useState(0);
  const [name, setName] = useState('');
  const [type, setType] = useState<BusinessType>('kelontong');
  const [tz, setTz] = useState<Tz>(guessTz());
  const [cash, setCash] = useState(0);
  const [bank, setBank] = useState(0);
  const [qris, setQris] = useState(0);
  const [busy, setBusy] = useState(false);

  const finish = async () => {
    setBusy(true);
    try {
      const balances = { cash, bank, qris };
      if (props.mode === 'guest') await createGuestWorkspace(name.trim(), type, tz, balances);
      else await createTenantWorkspace(name.trim(), type, tz, balances);
      go('/tx/in?first=1', true);
    } catch (e) {
      toast(e instanceof ApiError && e.code === 'signup_paused' ? 'Pendaftaran usaha baru sedang ditutup sementara.' : 'Gagal menyimpan. Coba lagi.');
      setBusy(false);
    }
  };

  return (
    <div>
      <TopBar title={props.mode === 'guest' ? 'Mulai Catat' : 'Usaha Baru'} backTo={meta.value.active ? '/settings' : '/'} />
      <div class="page">
        <div class="steps" aria-label={`Langkah ${step + 1} dari 2`}>
          <span class="on" />
          <span class={step === 1 ? 'on' : ''} />
        </div>
        {step === 0 && (
          <div class="form-section">
            <h2>Usahamu apa?</h2>
            <label class="field">
              Nama usaha
              <input class="input" autoFocus value={name} placeholder="cth. Warung Bu Sri" maxLength={80} onInput={(e) => setName(e.currentTarget.value)} />
            </label>
            <div class="eyebrow">Jenis usaha</div>
            <div class="chips">
              {BUSINESS_TYPES.map((b) => (
                <button key={b.value} type="button" class={`chip ${type === b.value ? 'on' : ''}`} onClick={() => setType(b.value)}>
                  {b.label}
                </button>
              ))}
            </div>
            <label class="field">
              Zona waktu
              <select class="input" value={tz} onChange={(e) => setTz(e.currentTarget.value as Tz)}>
                <option value="WIB">WIB (Sumatra, Jawa, Kalbar, Kalteng)</option>
                <option value="WITA">WITA (Bali, NTB, NTT, Kalsel, Kaltim, Sulawesi)</option>
                <option value="WIT">WIT (Maluku, Papua)</option>
              </select>
            </label>
            <button class="btn primary block large" disabled={!name.trim()} onClick={() => setStep(1)}>
              Lanjut
            </button>
          </div>
        )}
        {step === 1 && (
          <div class="form-section">
            <div class="stack tight">
              <h2>Ada uang usaha sekarang?</h2>
              <p class="small muted">Isi kira-kira saja supaya saldo di aplikasi cocok dengan kenyataan. Boleh dilewati, bisa diatur nanti.</p>
            </div>
            <MoneyInput label="Uang tunai di laci" value={cash} onChange={setCash} />
            <MoneyInput label="Saldo rekening bank usaha" value={bank} onChange={setBank} />
            <MoneyInput label="Saldo QRIS / e-wallet yang belum dicairkan" value={qris} onChange={setQris} />
            <button class="btn green block large" disabled={busy} onClick={finish}>
              {busy ? 'Menyiapkan…' : 'Selesai, mulai catat'}
            </button>
            <button class="btn ghost block" disabled={busy} onClick={() => setStep(0)}>
              Kembali
            </button>
          </div>
        )}
      </div>
    </div>
  );
}
