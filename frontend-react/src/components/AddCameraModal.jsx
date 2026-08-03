import { useState, useEffect } from 'react'
import { useMutation } from '@tanstack/react-query'
import { createCamera, updateCamera, uploadVideo } from '../api'
import { Modal, FormGroup, Btn } from './UI'
import styles from './AddCameraModal.module.css'

const SOURCE_TYPES = [
  {
    value: 'rtsp',
    label: 'RTSP',
    desc: 'IP Camera',
    icon: (
      <svg width="20" height="20" viewBox="0 0 24 24" fill="none">
        <rect x="2" y="5" width="15" height="11" rx="2" stroke="currentColor" strokeWidth="1.5"/>
        <path d="m17 9 4-2v6l-4-2" stroke="currentColor" strokeWidth="1.5" strokeLinejoin="round"/>
      </svg>
    ),
  },
  {
    value: 'http',
    label: 'HTTP',
    desc: 'MJPEG URL',
    icon: (
      <svg width="20" height="20" viewBox="0 0 24 24" fill="none">
        <circle cx="12" cy="12" r="9" stroke="currentColor" strokeWidth="1.5"/>
        <path d="M12 3c-2.4 2.8-3.5 5.6-3.5 9s1.1 6.2 3.5 9" stroke="currentColor" strokeWidth="1.5"/>
        <path d="M12 3c2.4 2.8 3.5 5.6 3.5 9s-1.1 6.2-3.5 9" stroke="currentColor" strokeWidth="1.5"/>
        <path d="M3 12h18" stroke="currentColor" strokeWidth="1.5"/>
      </svg>
    ),
  },
  {
    value: 'webcam',
    label: 'Webcam',
    desc: 'Kamera lokal',
    icon: (
      <svg width="20" height="20" viewBox="0 0 24 24" fill="none">
        <circle cx="12" cy="10" r="5" stroke="currentColor" strokeWidth="1.5"/>
        <circle cx="12" cy="10" r="2" stroke="currentColor" strokeWidth="1.5"/>
        <path d="M5 21c0-3.3 3.1-6 7-6s7 2.7 7 6" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round"/>
      </svg>
    ),
  },
  {
    value: 'video',
    label: 'Video',
    desc: 'Upload file',
    icon: (
      <svg width="20" height="20" viewBox="0 0 24 24" fill="none">
        <rect x="2" y="4" width="20" height="16" rx="2" stroke="currentColor" strokeWidth="1.5"/>
        <path d="M9.5 9.5 15 12l-5.5 2.5V9.5Z" fill="currentColor"/>
      </svg>
    ),
  },
  {
    value: 'youtube',
    label: 'Online',
    desc: 'yt-dlp URL',
    icon: (
      <svg width="20" height="20" viewBox="0 0 24 24" fill="none">
        <path d="M22 7s-.3-1.8-1.1-2.6c-1-.9-2.1-1-2.6-1C15.6 3.2 12 3.2 12 3.2s-3.6 0-6.3.2c-.5 0-1.6.1-2.6 1C2.3 5.2 2 7 2 7S1.7 9.1 1.7 11.2v2c0 2.1.3 4.2.3 4.2s.3 1.8 1.1 2.6c1 .9 2.3.9 2.9 1C7.7 21.1 12 21.2 12 21.2s3.6 0 6.3-.3c.5 0 1.6-.1 2.6-1 .8-.8 1.1-2.6 1.1-2.6S22.3 15.3 22.3 13.2v-2C22.3 9.1 22 7 22 7Z" stroke="currentColor" strokeWidth="1.5"/>
        <path d="M10 15.5v-7l6 3.5-6 3.5Z" fill="currentColor"/>
      </svg>
    ),
  },
]

const DEFAULT = {
  name: '', location_label: '', source_type: 'rtsp',
  rtsp_url: '', webcam_index: 0,
}

export default function AddCameraModal({ open, onClose, onSaved, camera }) {
  const isEdit = !!camera
  const [form,  setForm]  = useState(DEFAULT)
  const [file,  setFile]  = useState(null)
  const [error, setError] = useState('')
  const [uploadProgress, setUploadProgress] = useState(0)

  useEffect(() => {
    if (camera) {
      setForm({
        name:           camera.name           || '',
        location_label: camera.location_label || '',
        source_type:    camera.source_type    || 'rtsp',
        rtsp_url:       camera.rtsp_url       || '',
        webcam_index:   camera.webcam_index   ?? 0,
      })
    } else {
      setForm(DEFAULT)
    }
    setFile(null)
    setError('')
    setUploadProgress(0)
  }, [camera, open])

  const set = (k, v) => setForm(f => ({ ...f, [k]: v }))

  const saveMut = useMutation({
    mutationFn: async () => {
      const payload = {
        name:           form.name.trim(),
        location_label: form.location_label.trim() || null,
        source_type:    form.source_type,
        rtsp_url:       ['rtsp', 'http', 'youtube'].includes(form.source_type)
                          ? form.rtsp_url.trim() : null,
        webcam_index:   form.source_type === 'webcam'
                          ? Number(form.webcam_index) : null,
      }
      if (isEdit) {
        await updateCamera(camera.id, payload)
        if (form.source_type === 'video' && file) {
          await uploadVideo(camera.id, file, setUploadProgress)
        }
        return camera.id
      } else {
        const res = await createCamera(payload)
        const newId = res.data.id
        if (form.source_type === 'video' && file) {
          await uploadVideo(newId, file, setUploadProgress)
        }
        return newId
      }
    },
    onSuccess: () => onSaved(),
    onError:   (e) => setError(typeof e === 'string' ? e : 'Gagal menyimpan kamera.'),
  })

  function handleSubmit() {
    setError('')
    if (!form.name.trim()) { setError('Nama kamera wajib diisi.'); return }
    if (['rtsp', 'http', 'youtube'].includes(form.source_type) && !form.rtsp_url.trim()) {
      setError('URL wajib diisi untuk tipe sumber ini.'); return
    }
    if (form.source_type === 'video' && !isEdit && !file) {
      setError('Pilih file video untuk diunggah.'); return
    }
    saveMut.mutate()
  }

  const activeType = SOURCE_TYPES.find(t => t.value === form.source_type)

  return (
    <Modal
      open={open}
      onClose={onClose}
      title={isEdit ? `Edit — ${camera?.name}` : 'Tambah Kamera Baru'}
      footer={
        <>
          <Btn variant="outline" onClick={onClose} disabled={saveMut.isPending}>Batal</Btn>
          <Btn variant="primary" loading={saveMut.isPending} onClick={handleSubmit}>
            {isEdit ? 'Simpan Perubahan' : 'Tambah Kamera'}
          </Btn>
        </>
      }
    >
      {/* ── Source type selector ──────────────────────────────────────────── */}
      <div className={styles.sourceGrid}>
        {SOURCE_TYPES.map(t => (
          <button
            key={t.value}
            type="button"
            className={`${styles.sourceCard} ${form.source_type === t.value ? styles.sourceCardActive : ''}`}
            onClick={() => set('source_type', t.value)}
          >
            <span className={styles.sourceIcon}>{t.icon}</span>
            <span className={styles.sourceLabel}>{t.label}</span>
            <span className={styles.sourceDesc}>{t.desc}</span>
          </button>
        ))}
      </div>

      {/* ── Common fields ────────────────────────────────────────────────── */}
      <FormGroup label="Nama Kamera">
        <input
          value={form.name}
          onChange={e => set('name', e.target.value)}
          placeholder="mis. Pintu Masuk Utama"
          autoFocus
        />
      </FormGroup>

      <FormGroup label="Label Lokasi (opsional)">
        <input
          value={form.location_label}
          onChange={e => set('location_label', e.target.value)}
          placeholder="mis. Lantai 1 — Lobby"
        />
      </FormGroup>

      {/* ── Source-specific fields ───────────────────────────────────────── */}
      {form.source_type === 'rtsp' && (
        <FormGroup label="RTSP URL">
          <input
            value={form.rtsp_url}
            onChange={e => set('rtsp_url', e.target.value)}
            placeholder="rtsp://user:pass@192.168.1.10:554/stream"
            spellCheck={false}
          />
        </FormGroup>
      )}

      {form.source_type === 'http' && (
        <FormGroup label="HTTP / MJPEG URL">
          <input
            value={form.rtsp_url}
            onChange={e => set('rtsp_url', e.target.value)}
            placeholder="http://192.168.1.10:8080/video"
            spellCheck={false}
          />
        </FormGroup>
      )}

      {form.source_type === 'youtube' && (
        <FormGroup label="URL Video Online">
          <input
            value={form.rtsp_url}
            onChange={e => set('rtsp_url', e.target.value)}
            placeholder="https://www.youtube.com/watch?v=..."
            spellCheck={false}
          />
          <p className={styles.hint}>Membutuhkan yt-dlp terinstall di server.</p>
        </FormGroup>
      )}

      {form.source_type === 'webcam' && (
        <FormGroup label="Indeks Webcam">
          <input
            type="number"
            min={0}
            max={9}
            value={form.webcam_index}
            onChange={e => set('webcam_index', e.target.value)}
          />
          <p className={styles.hint}>0 = webcam default. Naikkan jika ada beberapa kamera.</p>
        </FormGroup>
      )}

      {form.source_type === 'video' && (
        <FormGroup label={isEdit ? 'Ganti File Video (opsional)' : 'File Video'}>
          <label className={styles.fileLabel}>
            <input
              type="file"
              accept="video/*"
              style={{ display: 'none' }}
              onChange={e => setFile(e.target.files[0] || null)}
            />
            <span className={styles.fileTrigger}>
              <svg width="14" height="14" viewBox="0 0 16 16" fill="none">
                <path d="M8 11V3M4 7l4-4 4 4" stroke="currentColor" strokeWidth="1.3" strokeLinecap="round" strokeLinejoin="round"/>
                <path d="M2 13h12" stroke="currentColor" strokeWidth="1.3" strokeLinecap="round"/>
              </svg>
              {file ? file.name : 'Pilih file video...'}
            </span>
            {file && (
              <span className={styles.fileSize}>
                {(file.size / 1024 / 1024).toFixed(1)} MB
              </span>
            )}
          </label>
          {saveMut.isPending && file && uploadProgress > 0 && (
            <div className={styles.progressWrap}>
              <div className={styles.progressBar} style={{ width: `${uploadProgress}%` }} />
            </div>
          )}
        </FormGroup>
      )}

      {/* ── Error ───────────────────────────────────────────────────────── */}
      {error && (
        <div className={styles.errorBox}>
          <svg width="12" height="12" viewBox="0 0 12 12" fill="none" style={{ flexShrink: 0 }}>
            <circle cx="6" cy="6" r="5" stroke="currentColor" strokeWidth="1.2"/>
            <path d="M6 4v2.5M6 8h.01" stroke="currentColor" strokeWidth="1.2" strokeLinecap="round"/>
          </svg>
          {error}
        </div>
      )}
    </Modal>
  )
}
