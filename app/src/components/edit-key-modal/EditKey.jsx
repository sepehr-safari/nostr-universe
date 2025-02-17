import { useContext, useRef } from 'react'
import Button from 'react-bootstrap/Button'
import { AiOutlineClose } from 'react-icons/ai'
import { MdOutlineDone } from 'react-icons/md'

import { getNpub, getShortenText } from '../../utils/helpers/general'
import { AppContext } from '../../store/app-context'

export const EditKey = ({ onCloseModal }) => {
	const contextData = useContext(AppContext)
	const { keyProp, onCopyKey, onShowKey, onEditKey } = contextData || {}
	const ref = useRef()
	const key = getNpub(keyProp.publicKey)
	const shortKey = getShortenText(key)

	return (
		<div className='d-flex flex-column'>
			<div className='d-flex justify-content-between align-items-center p-3'>
				<h2 className='m-0'>Edit key</h2>
				<AiOutlineClose
					color='white'
					size={30}
					onClick={onCloseModal}
				/>
			</div>
			<div className='fs-2 pb-2 align-self-center'>{shortKey}</div>
			<hr className='m-0' />
			<div className='d-flex p-3 justify-content-between align-items-center'>
				<Button variant='secondary' size='lg' onClick={onCopyKey}>
					Copy
				</Button>
				<Button variant='secondary' size='lg' onClick={onShowKey}>
					Show secret
				</Button>
			</div>
			<div>
				<h2 className='m-0 p-3'>Attributes</h2>
			</div>
			<div className='d-flex px-3 gap-3 align-items-center'>
				<div className='fs-3 '>Name: </div>
				<input type='text' ref={ref} defaultValue={keyProp.name} />
				<MdOutlineDone
					color='white'
					size={30}
					className='iconDropDown'
					onClick={() =>
						onEditKey({
							publicKey: keyProp.publicKey,
							name: ref.current.value,
						})
					}
				/>
			</div>
			<div>
				<h2 className='m-0 p-3'>Profile</h2>
			</div>
		</div>
	)
}
