import { useState } from 'react'
import { Book } from '../types'
import { useStore } from '../store/useStore'
import { tr } from '../i18n'
import { IconStar, IconPlay, IconTrash } from './icons'
import { placeholderCover } from '../lib/util'

export function BookCard({ book, onOpen }: { book: Book; onOpen: (b: Book) => void }) {
  const toggleFav = useStore((s) => s.toggleFavorite)
  const removeBook = useStore((s) => s.removeBook)
  const lang = useStore((s) => s.settings.lang)
  const [confirm, setConfirm] = useState(false)
  const cover = book.cover || placeholderCover(book.name)
  return (
    <div className='card' onDoubleClick={() => onOpen(book)}>
      <img className='cover' src={cover} alt={book.name} draggable={false} onClick={() => onOpen(book)} />
      <button className='del' title={tr(lang, 'delete')}
        onClick={(e) => { e.stopPropagation(); setConfirm(true) }}>
        <IconTrash size={15} />
      </button>
      {book.favorite && (
        <div className='fav' onClick={(e) => { e.stopPropagation(); toggleFav(book.id) }}>
          <IconStar size={15} fill='#ffce3d' stroke='#ffce3d' />
        </div>
      )}
      <div className='meta'>
        <div className='name'>{book.name}</div>
        <div className='author'>{book.author || '—'}</div>
        <div className='bar'><i style={{ width: `${book.progress}%` }} /></div>
      </div>
      {confirm && (
        <div className='del-confirm' onClick={(e) => { e.stopPropagation(); setConfirm(false) }}>
          <div className='del-text'>{tr(lang, 'confirmDelete')}</div>
          <div className='del-actions'>
            <button onClick={(e) => { e.stopPropagation(); setConfirm(false) }}>{tr(lang, 'cancel')}</button>
            <button className='danger' onClick={(e) => { e.stopPropagation(); removeBook(book.id) }}>{tr(lang, 'delete')}</button>
          </div>
        </div>
      )}
    </div>
  )
}

export function BookRow({ book, onOpen }: { book: Book; onOpen: (b: Book) => void }) {
  const toggleFav = useStore((s) => s.toggleFavorite)
  const removeBook = useStore((s) => s.removeBook)
  const lang = useStore((s) => s.settings.lang)
  const [confirm, setConfirm] = useState(false)
  const cover = book.cover || placeholderCover(book.name)
  return (
    <div className='row' onDoubleClick={() => onOpen(book)}>
      <img className='thumb' src={cover} alt={book.name} draggable={false} onClick={() => onOpen(book)} />
      <div className='info' onClick={() => onOpen(book)}>
        <div className='n'>{book.name}</div>
        <div className='a'>{book.author || '—'}</div>
      </div>
      <div className='pbar'><i style={{ width: `${book.progress}%` }} /></div>
      <button className='icon-btn' title='收藏' onClick={() => toggleFav(book.id)}>
        <IconStar size={16} fill={book.favorite ? '#ffce3d' : 'none'} stroke={book.favorite ? '#ffce3d' : 'currentColor'} />
      </button>
      <button className='icon-btn' title={tr(lang, 'delete')}
        onClick={() => setConfirm(true)}>
        <IconTrash size={16} />
      </button>
      <button className='icon-btn accent' title='阅读' onClick={() => onOpen(book)}><IconPlay size={16} /></button>
      {confirm && (
        <div className='del-confirm' onClick={(e) => { e.stopPropagation(); setConfirm(false) }}>
          <div className='del-text'>{tr(lang, 'confirmDelete')}</div>
          <div className='del-actions'>
            <button onClick={(e) => { e.stopPropagation(); setConfirm(false) }}>{tr(lang, 'cancel')}</button>
            <button className='danger' onClick={(e) => { e.stopPropagation(); removeBook(book.id) }}>{tr(lang, 'delete')}</button>
          </div>
        </div>
      )}
    </div>
  )
}
