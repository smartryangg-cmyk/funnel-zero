//go:build !windows

package main

import "errors"

func protectLocalSecret([]byte) ([]byte, error) {
	return nil, errors.New("o cofre local protegido está disponível no app Windows")
}

func unprotectLocalSecret([]byte) ([]byte, error) {
	return nil, errors.New("o cofre local protegido está disponível no app Windows")
}
