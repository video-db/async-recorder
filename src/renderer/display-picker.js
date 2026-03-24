const picker = document.getElementById('picker');

window.recorderAPI.onDisplayPickerInit((payload) => {
    if (payload?.theme) {
        document.documentElement.setAttribute('data-theme', payload.theme);
    }
    const displays = Array.isArray(payload?.displays) ? payload.displays : [];
    const selectedId = payload?.selectedDisplayId || null;

    if (!picker) return;
    picker.innerHTML = '';

    for (const display of displays) {
        const isSelected = display.id === selectedId;
        const item = document.createElement('button');
        item.className = `picker-item${isSelected ? ' selected' : ''}`;

        const checkMark = document.createElement('span');
        checkMark.className = 'check-mark';
        checkMark.innerHTML = isSelected ? '&#10003;' : '';

        const name = document.createElement('span');
        name.className = 'name';
        name.textContent = display.name;

        item.appendChild(checkMark);
        item.appendChild(name);

        item.addEventListener('click', () => {
            window.recorderAPI.selectDisplayFromPicker({ id: display.id, name: display.name });
        });

        picker.appendChild(item);
    }
});

window.addEventListener('keydown', (e) => {
    if (e.key === 'Escape') window.recorderAPI.cancelDisplayPicker();
});
