import { useState, useEffect } from 'react'
import { useMutation } from '@tanstack/react-query'
import { createCamera, updateCamera, uploadVideo } from '../api'
import { Modal, FormGroup, Btn } from './UI'

const SOURCE_TYPES = [
  { value: 'rtsp',     label: 'RTSP Stream' },
  { value: 'webcam',   label: 'Webcam Lokal' },
  { value: 'video',    label: 'File Video'   },
  { value: 'http',     label: 'HTTP / MJPEG URL' },
  { value: 'youtube',  label: 'YouTube / URL Online (yt-dlp)' },
]

const DEFAULT = {
  name: '', location_label: '', source_type: 'rtsp',
  rtsp_url: '', webcam_index: 0,
}

export default function AddCameraModal({ open, onClose, onSaved, camera }) {
  const isEdit = !!camera
  const [form,    setForm]    = useState(DEFAULT)
  const [file,    setFile]    = useState(null)
  const [error,   setError]   = useState('')
  const [step,    setStep]    = useState('form') // 'form' | 'upload'

  // Populate form when editing
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
    setStep('form')
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
          await uploadVideo(camera.id, file)
        }
        return camera.id
      } else {
        const res = await createCamera(payload)
        const newId = res.data.id
        if (form.source_type === 'video' && file) {
          await uploadVideo(newId, file)
        }
        return newId
      }
    },
    onSuccess: () => onSaved(),
    onError: (e) => setError(typeof e === 'string' ? e : 'Gagal menyimpan kamera.'),
  })

  function handleSubmit() {
    setError('')
    if (!form.name.trim()) { setError('Nama kamera wajib diisi.'); return }
    if ((form.source_type === 'rtsp' || form.source_type === 'http' || form.source_type === 'youtube') && !form.rtsp_url.trim()) {
      setError('URL wajib diisi untuk tipe sumber ini.'); return
    }
    if (form.source_type === 'video' && !isEdit && !file) {
      setError('Pilih file video untuk diunggah.'); return
    }
    saveMut.mutate()
  }

  return (
    <Modal
      open={open}
      onClose={onClose}
      title={isEdit ? `Edit Kamera — ${camera?.name}` : 'Tambah Kamera Baru'}
      footer={
        <>
          <Btn variant="outline" onClick={onClose}>Batal</Btn>
          <Btn variant="primary" loading={saveMut.isPending} onClick={handleSubmit}>
            {isEdit ? 'Simpan Perubahan' : 'Tambah Kamera'}
          </Btn>
        </>
      }
    >
      <FormGroup label="Nama Kamera">
        <input value={form.name} onChange={e => set('name', e.target.value)}
          placeholder="mis. Pintu Masuk Utama" />
      </FormGroup>

      <FormGroup label="Label Lokasi (opsional)">
        <input value={form.location_label} onChange={e => set('location_label', e.target.value)}
          placeholder="mis. Lantai 1 — Lobby" />
      </FormGroup>

      <FormGroup label="Tipe Sumber">
        <select value={form.source_type} onChange={e => set('source_type', e.target.value)}>
          {SOURCE_TYPES.map(t => (
            <option key={t.value} value={t.value}>{t.label}</option>
          ))}
        </select>
      </FormGroup>

      {(form.source_type === 'rtsp' || form.source_type === 'http') && (
        <FormGroup label={form.source_type === 'rtsp' ? 'RTSP URL' : 'HTTP / MJPEG URL'}>
          <input value={form.rtsp_url}
            onChange={e => set('rtsp_url', e.target.value)}
            placeholder={
              form.source_type === 'rtsp'
                ? 'rtsp://user:pass@192.168.1.10:554/stream'
                : 'http://192.168.1.10:8080/video'
            }
          />
        </FormGroup>
      )}

      {form.source_type === 'youtube' && (
        <FormGroup label="URL Video Online">
          <input value={form.rtsp_url}
            onChange={e => set('rtsp_url', e.target.value)}
            placeholder="https://www.youtube.com/watch?v=... atau URL live stream lainnya"
          />
          <div style={{ fontSize: '.75rem', color: 'var(--muted)', marginTop: '.35rem', lineHeight: 1.5 }}>
            Didukung: YouTube, Twitch, Facebook Live, Instagram, TikTok, Vimeo, Dailymotion, dan 1000+ situs lainnya via yt-dlp.
          </div>
        </FormGroup>
      )}

      {form.source_type === 'webcam' && (
        <FormGroup label="Index Webcam">
          <input type="number" min={0} max={10} value={form.webcam_index}
            onChange={e => set('webcam_index', e.target.value)} style={{ width: 100 }} />
        </FormGroup>
      )}

      {form.source_type === 'video' && (
        <FormGroup label={isEdit ? 'Ganti File Video (opsional)' : 'File Video'}>
          <input type="file" accept="video/*"
            style={{ background: 'transparent', border: 'none', padding: 0 }}
            onChange={e => setFile(e.target.files?.[0] || null)} />
          {file && (
            <div style={{ fontSize: '.78rem', color: 'var(--muted)', marginTop: '.25rem' }}>
              {file.name} — {(file.size / 1024 / 1024).toFixed(1)} MB
            </div>
          )}
        </FormGroup>
      )}

      {error && (
        <div style={{ color: 'var(--danger)', fontSize: '.82rem', marginTop: '.25rem' }}>{error}</div>
      )}
    </Modal>
  )
}
