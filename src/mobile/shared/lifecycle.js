    const MOBILE_RESTORED_ATTRIBUTES = ['style', 'class', 'hidden', 'aria-hidden'];

    function captureMobileElementState(element) {
        const attributes = Object.create(null);
        for (const name of MOBILE_RESTORED_ATTRIBUTES) {
            attributes[name] = {
                present: element.hasAttribute(name),
                value: element.getAttribute(name),
            };
        }
        return {
            parent: element.parentNode,
            nextSibling: element.nextSibling,
            attributes,
        };
    }

    function restoreMobileElementState(element, state) {
        for (const name of MOBILE_RESTORED_ATTRIBUTES) {
            const saved = state.attributes[name];
            if (saved.present) element.setAttribute(name, saved.value === null ? '' : saved.value);
            else element.removeAttribute(name);
        }
    }

    function createMobileLifecycle(documentRef) {
        const presentationRecords = [];
        const capturedPresentation = new WeakSet();
        const movedRecords = [];
        const movedByElement = new WeakMap();
        const listenerRecords = [];
        let destroyed = false;

        function capturePresentation(element) {
            if (!element || capturedPresentation.has(element)) return;
            capturedPresentation.add(element);
            presentationRecords.push({ element, state: captureMobileElementState(element) });
        }

        function moveElement(element, target) {
            if (!element || !target) return null;
            let record = movedByElement.get(element);
            if (!record) {
                const state = captureMobileElementState(element);
                let anchor = null;
                if (state.parent && typeof documentRef.createComment === 'function') {
                    anchor = documentRef.createComment('gpc-mobile-overhaul-original-position');
                    state.parent.insertBefore(anchor, element);
                }
                record = { element, state, anchor, restored: false };
                movedByElement.set(element, record);
                movedRecords.push(record);
            }
            if (element.parentNode !== target) target.appendChild(element);
            return record;
        }

        function listen(element, type, listener, options) {
            if (!element || typeof element.addEventListener !== 'function') return;
            element.addEventListener(type, listener, options);
            listenerRecords.push({ element, type, listener, options });
        }

        function restoreMoved(record) {
            if (!record || record.restored) return;
            record.restored = true;
            const { element, state, anchor } = record;

            if (anchor && anchor.parentNode) {
                const anchorParent = anchor.parentNode;
                anchorParent.insertBefore(element, anchor);
                anchorParent.removeChild(anchor);
            } else if (state.parent) {
                if (state.nextSibling && state.nextSibling.parentNode === state.parent) {
                    state.parent.insertBefore(element, state.nextSibling);
                } else {
                    state.parent.appendChild(element);
                }
            }
            restoreMobileElementState(element, state);
        }

        function destroy() {
            if (destroyed) return;
            destroyed = true;

            for (let index = listenerRecords.length - 1; index >= 0; index -= 1) {
                const record = listenerRecords[index];
                record.element.removeEventListener(
                    record.type,
                    record.listener,
                    record.options
                );
            }
            for (let index = movedRecords.length - 1; index >= 0; index -= 1) {
                restoreMoved(movedRecords[index]);
            }
            for (let index = presentationRecords.length - 1; index >= 0; index -= 1) {
                const record = presentationRecords[index];
                restoreMobileElementState(record.element, record.state);
            }
        }

        return Object.freeze({
            capturePresentation,
            moveElement,
            listen,
            destroy,
        });
    }
