document.addEventListener('DOMContentLoaded', function () {
    const dashboard = document.querySelector('.dashboard');
    const toggleBtn = document.getElementById('sidebar-toggle');
    const backdrop = document.getElementById('sidebar-backdrop');

    if (!dashboard || !toggleBtn) return; // safety check - do nothing if a page is missing these

    const icon = toggleBtn.querySelector('i');

    function setOpen(isOpen) {
        document.body.classList.toggle('sidebar-open', isOpen);

        if (icon) {
            icon.classList.toggle('bi-chevron-right', !isOpen);
            icon.classList.toggle('bi-chevron-left', isOpen);
        }

        toggleBtn.setAttribute('aria-label', isOpen ? 'Close menu' : 'Open menu');
    }

    toggleBtn.addEventListener('click', function () {
        setOpen(!dashboard.classList.contains('sidebar-open'));
    });

    // Tapping the dimmed background closes the drawer, same as most apps.
    if (backdrop) {
        backdrop.addEventListener('click', function () {
            setOpen(false);
        });
    }

    // Picking a page from the menu should close the drawer behind you.
    document.querySelectorAll('.nav-item').forEach(function (item) {
        item.addEventListener('click', function () {
            setOpen(false);
        });
    });
});