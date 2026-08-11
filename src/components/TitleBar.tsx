import { IconMin, IconMax, IconSquare, IconClose } from './icons'

export default function TitleBar() {
  const api = (window as any).electronAPI
  return (
    <div className='titlebar'>
      <span className='title'>NovelReader</span>
      <span className='spacer' />
      {api && (
        <>
          <div className='win-btn' onClick={() => api.winMin()} title='最小化'><IconMin size={14} /></div>
          <div className='win-btn' onClick={() => api.winMax()} title='最大化'><IconSquare size={12} /></div>
          <div className='win-btn close' onClick={() => api.winClose()} title='关闭'><IconClose size={14} /></div>
        </>
      )}
    </div>
  )
}
