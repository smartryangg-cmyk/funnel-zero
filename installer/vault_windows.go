//go:build windows

package main

import (
	"errors"
	"runtime"
	"syscall"
	"unsafe"
)

type dataBlob struct {
	size uint32
	data *byte
}

var (
	crypt32              = syscall.NewLazyDLL("crypt32.dll")
	kernel32             = syscall.NewLazyDLL("kernel32.dll")
	cryptProtectData     = crypt32.NewProc("CryptProtectData")
	cryptUnprotectData   = crypt32.NewProc("CryptUnprotectData")
	localFree            = kernel32.NewProc("LocalFree")
	vaultOptionalEntropy = []byte("KRANO Desktop local vault v1")
)

const cryptProtectUIForbidden = 0x1

func protectLocalSecret(value []byte) ([]byte, error) {
	return runDPAPI(cryptProtectData, value)
}

func unprotectLocalSecret(value []byte) ([]byte, error) {
	return runDPAPI(cryptUnprotectData, value)
}

func runDPAPI(procedure *syscall.LazyProc, value []byte) ([]byte, error) {
	if len(value) == 0 {
		return nil, errors.New("o segredo local está vazio")
	}
	input := blobFromBytes(value)
	entropy := blobFromBytes(vaultOptionalEntropy)
	var output dataBlob
	result, _, callErr := procedure.Call(
		uintptr(unsafe.Pointer(&input)),
		0,
		uintptr(unsafe.Pointer(&entropy)),
		0,
		0,
		cryptProtectUIForbidden,
		uintptr(unsafe.Pointer(&output)),
	)
	runtime.KeepAlive(value)
	runtime.KeepAlive(vaultOptionalEntropy)
	if result == 0 {
		if callErr != syscall.Errno(0) {
			return nil, callErr
		}
		return nil, errors.New("o Windows não conseguiu proteger a credencial")
	}
	defer localFree.Call(uintptr(unsafe.Pointer(output.data)))
	if output.data == nil || output.size == 0 {
		return nil, errors.New("o Windows devolveu uma credencial vazia")
	}
	copyOfOutput := append([]byte(nil), unsafe.Slice(output.data, int(output.size))...)
	return copyOfOutput, nil
}

func blobFromBytes(value []byte) dataBlob {
	if len(value) == 0 {
		return dataBlob{}
	}
	return dataBlob{size: uint32(len(value)), data: &value[0]}
}
