'use client'
import { useEffect, useRef } from 'react'

/**
 * Three.js ambient for the splash only: slow-drifting warm motes, like
 * dust over a candlelit table. Lazy-loaded (this module is only pulled
 * in via next/dynamic), DPR-capped at 2, paused when the tab hides,
 * fully disposed on unmount. Atmosphere must never tax the workspace.
 */
export default function Ambient() {
  const mountRef = useRef<HTMLDivElement>(null)

  useEffect(() => {
    const mount = mountRef.current
    if (!mount) return
    let disposed = false
    let cleanup: (() => void) | undefined

    void import('three').then((THREE) => {
      if (disposed || !mountRef.current) return

      const scene = new THREE.Scene()
      const camera = new THREE.PerspectiveCamera(60, 1, 0.1, 50)
      camera.position.z = 10

      const renderer = new THREE.WebGLRenderer({ alpha: true, antialias: false })
      renderer.setPixelRatio(Math.min(window.devicePixelRatio, 2))
      mount.appendChild(renderer.domElement)

      const COUNT = 140
      const positions = new Float32Array(COUNT * 3)
      const drift = new Float32Array(COUNT * 3)
      for (let i = 0; i < COUNT; i++) {
        positions[i * 3] = (Math.random() - 0.5) * 22
        positions[i * 3 + 1] = (Math.random() - 0.5) * 14
        positions[i * 3 + 2] = (Math.random() - 0.5) * 8
        drift[i * 3] = (Math.random() - 0.5) * 0.0024
        drift[i * 3 + 1] = Math.random() * 0.0016 + 0.0004
        drift[i * 3 + 2] = 0
      }
      const geo = new THREE.BufferGeometry()
      geo.setAttribute('position', new THREE.BufferAttribute(positions, 3))
      const mat = new THREE.PointsMaterial({
        color: 0xe8a14b,
        size: 0.055,
        transparent: true,
        opacity: 0.5,
        depthWrite: false,
      })
      scene.add(new THREE.Points(geo, mat))

      let raf = 0
      let running = true
      const tick = () => {
        if (!running) return
        const pos = geo.getAttribute('position') as InstanceType<typeof THREE.BufferAttribute>
        const arr = pos.array as Float32Array
        for (let i = 0; i < COUNT; i++) {
          arr[i * 3] = arr[i * 3]! + drift[i * 3]!
          arr[i * 3 + 1] = arr[i * 3 + 1]! + drift[i * 3 + 1]!
          if (arr[i * 3 + 1]! > 7) arr[i * 3 + 1] = -7
          if (arr[i * 3]! > 11) arr[i * 3] = -11
          if (arr[i * 3]! < -11) arr[i * 3] = 11
        }
        pos.needsUpdate = true
        renderer.render(scene, camera)
        raf = requestAnimationFrame(tick)
      }

      const resize = () => {
        const { clientWidth: w, clientHeight: h } = mount
        renderer.setSize(w, h, false)
        camera.aspect = w / Math.max(1, h)
        camera.updateProjectionMatrix()
      }
      resize()
      window.addEventListener('resize', resize)

      const onVisibility = () => {
        running = document.visibilityState === 'visible'
        if (running) tick()
        else cancelAnimationFrame(raf)
      }
      document.addEventListener('visibilitychange', onVisibility)
      tick()

      cleanup = () => {
        running = false
        cancelAnimationFrame(raf)
        window.removeEventListener('resize', resize)
        document.removeEventListener('visibilitychange', onVisibility)
        geo.dispose()
        mat.dispose()
        renderer.dispose()
        renderer.domElement.remove()
      }
    })

    return () => {
      disposed = true
      cleanup?.()
    }
  }, [])

  return <div ref={mountRef} aria-hidden className="absolute inset-0 -z-10 opacity-70" />
}
