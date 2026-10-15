import { signal } from '@preact/signals';
import { Smartphone, X } from 'lucide-preact';
import { meta, updateMeta } from '../store/meta';

interface InstallPromptEvent extends Event {
  prompt: () => Promise<void>;
  userChoice: Promise<{ outcome: string }>;
}

const deferred = signal<InstallPromptEvent | null>(null);

window.addEventListener('beforeinstallprompt', (e) => {
  e.preventDefault();
  deferred.value = e as InstallPromptEvent;
});
window.addEventListener('appinstalled', () => (deferred.value = null));

export const isStandalone = () =>
  window.matchMedia('(display-mode: standalone)').matches || (navigator as Navigator & { standalone?: boolean }).standalone === true;

export const isIos = () => /iPhone|iPad|iPod/.test(navigator.userAgent);

export function InstallHelp(props: { compact?: boolean }) {
  if (isStandalone()) return null;
  const ev = deferred.value;
  return (
    <div class="card stack">
      <div class="row loose">
        <span class="set-icon green" aria-hidden="true">
          <Smartphone size={17} />
        </span>
        <h3>Pasang di layar utama</h3>
      </div>
      {ev ? (
        <>
          <p class="small muted">Biar buka aplikasinya cepat seperti aplikasi biasa dan datanya lebih awet tersimpan.</p>
          <button
            class="btn primary"
            onClick={async () => {
              await ev.prompt();
              await ev.userChoice;
              deferred.value = null;
            }}
          >
            Pasang aplikasi
          </button>
        </>
      ) : isIos() ? (
        <ol class="howto">
          <li>Buka halaman ini di <b>Safari</b>.</li>
          <li>Ketuk tombol <b>Bagikan</b> (kotak dengan panah ke atas).</li>
          <li>Pilih <b>Tambahkan ke Layar Utama</b>, lalu <b>Tambah</b>.</li>
          {!props.compact && (
            <li>
              <b>Penting di iPhone:</b> kalau tidak dipasang, Safari bisa menghapus datamu setelah sekitar 7 hari tidak dibuka.
            </li>
          )}
        </ol>
      ) : (
        <ol class="howto">
          <li>Buka halaman ini di <b>Chrome</b>.</li>
          <li>Ketuk menu <b>⋮</b> di pojok kanan atas.</li>
          <li>Pilih <b>Instal aplikasi</b> atau <b>Tambahkan ke layar utama</b>.</li>
        </ol>
      )}
    </div>
  );
}

export function InstallBanner() {
  const m = meta.value;
  if (isStandalone() || (m.installDismissedAt && Date.now() - m.installDismissedAt < 14 * 86_400_000)) return null;
  if (!deferred.value && !isIos()) return null;
  return (
    <div class={`banner ${isIos() ? 'amber' : 'green'} no-print`}>
      <span class="banner-icon">
        <Smartphone size={16} aria-hidden="true" />
      </span>
      <div class="grow">
        {isIos()
          ? 'Pasang aplikasi ke Layar Utama (Bagikan → Tambahkan ke Layar Utama) supaya data tidak dihapus Safari.'
          : 'Pasang BukuLapak di layar utama biar lebih cepat dibuka.'}
        {deferred.value && (
          <div class="banner-actions">
            <button class="btn small primary" onClick={() => void deferred.value?.prompt()}>
              Pasang
            </button>
          </div>
        )}
      </div>
      <button
        class="icon-btn plain"
        aria-label="Tutup"
        onClick={() =>
          updateMeta((x) => {
            x.installDismissedAt = Date.now();
          })
        }
      >
        <X size={16} />
      </button>
    </div>
  );
}
