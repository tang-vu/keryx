//! Strict supported Windows shape: current-user owner and one current-user
//! full-access ACE. The selected parent also has protected inheritance and an
//! inheritable ACE, so newly created children cannot inherit broad grants.
use std::{ffi::c_void, io, os::windows::io::RawHandle};
#[cfg(any(test, feature = "publication-evaluation"))]
use windows_sys::Win32::Security::{
    SetTokenInformation, TokenOwner, TOKEN_ADJUST_DEFAULT, TOKEN_OWNER,
};
use windows_sys::Win32::{
    Foundation::{CloseHandle, LocalFree},
    Security::{
        Authorization::{GetSecurityInfo, SE_FILE_OBJECT},
        EqualSid, GetAce, GetSecurityDescriptorControl, GetTokenInformation, TokenUser,
        ACCESS_ALLOWED_ACE, ACL, CONTAINER_INHERIT_ACE, DACL_SECURITY_INFORMATION,
        INHERIT_ONLY_ACE, NO_PROPAGATE_INHERIT_ACE, OBJECT_INHERIT_ACE, OWNER_SECURITY_INFORMATION,
        SE_DACL_PROTECTED, TOKEN_QUERY, TOKEN_USER,
    },
    Storage::FileSystem::FILE_ALL_ACCESS,
    System::{
        SystemServices::ACCESS_ALLOWED_ACE_TYPE,
        Threading::{GetCurrentProcess, OpenProcessToken},
    },
};

fn denied(message: &'static str) -> io::Error {
    io::Error::new(io::ErrorKind::PermissionDenied, message)
}

struct LocalSecurity(*mut c_void);
impl Drop for LocalSecurity {
    fn drop(&mut self) {
        if !self.0.is_null() {
            unsafe { LocalFree(self.0) };
        }
    }
}

fn current_user_sid() -> io::Result<Vec<usize>> {
    let mut token = std::ptr::null_mut();
    if unsafe { OpenProcessToken(GetCurrentProcess(), TOKEN_QUERY, &mut token) } == 0 {
        return Err(io::Error::last_os_error());
    }
    let result = (|| {
        let mut size = 0;
        unsafe { GetTokenInformation(token, TokenUser, std::ptr::null_mut(), 0, &mut size) };
        if size < std::mem::size_of::<TOKEN_USER>() as u32 || size > 65_536 {
            return Err(denied("cannot obtain current-user token SID"));
        }
        let words = (size as usize).div_ceil(std::mem::size_of::<usize>());
        let mut buffer = vec![0usize; words];
        if unsafe {
            GetTokenInformation(
                token,
                TokenUser,
                buffer.as_mut_ptr().cast(),
                size,
                &mut size,
            )
        } == 0
        {
            return Err(io::Error::last_os_error());
        }
        Ok(buffer)
    })();
    unsafe { CloseHandle(token) };
    result
}

/// Only test processes select their own user SID as the default owner for new
/// objects. Elevated Windows runners may otherwise default to Administrators.
/// This changes no machine policy and is never called by the normal publisher.
#[cfg(any(test, feature = "publication-evaluation"))]
pub(super) fn set_evaluation_default_owner() -> io::Result<()> {
    let current = current_user_sid()?;
    let user = unsafe { (*(current.as_ptr() as *const TOKEN_USER)).User.Sid };
    if user.is_null() {
        return Err(denied("current-user SID is missing"));
    }
    let mut token = std::ptr::null_mut();
    if unsafe {
        OpenProcessToken(
            GetCurrentProcess(),
            TOKEN_QUERY | TOKEN_ADJUST_DEFAULT,
            &mut token,
        )
    } == 0
    {
        return Err(io::Error::last_os_error());
    }
    let result = (|| {
        let desired = TOKEN_OWNER { Owner: user };
        if unsafe {
            SetTokenInformation(
                token,
                TokenOwner,
                (&desired as *const TOKEN_OWNER).cast(),
                std::mem::size_of::<TOKEN_OWNER>() as u32,
            )
        } == 0
        {
            return Err(io::Error::last_os_error());
        }
        let mut size = 0;
        unsafe { GetTokenInformation(token, TokenOwner, std::ptr::null_mut(), 0, &mut size) };
        if size < std::mem::size_of::<TOKEN_OWNER>() as u32 || size > 65_536 {
            return Err(denied("cannot verify evaluation token owner"));
        }
        let words = (size as usize).div_ceil(std::mem::size_of::<usize>());
        let mut buffer = vec![0usize; words];
        if unsafe {
            GetTokenInformation(
                token,
                TokenOwner,
                buffer.as_mut_ptr().cast(),
                size,
                &mut size,
            )
        } == 0
        {
            return Err(io::Error::last_os_error());
        }
        let actual = unsafe { (*(buffer.as_ptr() as *const TOKEN_OWNER)).Owner };
        if actual.is_null() || unsafe { EqualSid(actual, user) } == 0 {
            return Err(denied("evaluation token owner is not current user"));
        }
        Ok(())
    })();
    if unsafe { CloseHandle(token) } == 0 {
        return Err(io::Error::last_os_error());
    }
    result
}

pub(super) fn private_handle(handle: RawHandle, require_protected_parent: bool) -> io::Result<()> {
    let token = current_user_sid()?;
    let user = unsafe { (*(token.as_ptr() as *const TOKEN_USER)).User.Sid };
    if user.is_null() {
        return Err(denied("current-user SID is missing"));
    }
    let mut owner = std::ptr::null_mut();
    let mut dacl: *mut ACL = std::ptr::null_mut();
    let mut descriptor = std::ptr::null_mut();
    let status = unsafe {
        GetSecurityInfo(
            handle,
            SE_FILE_OBJECT,
            OWNER_SECURITY_INFORMATION | DACL_SECURITY_INFORMATION,
            &mut owner,
            std::ptr::null_mut(),
            &mut dacl,
            std::ptr::null_mut(),
            &mut descriptor,
        )
    };
    if status != 0 {
        return Err(io::Error::from_raw_os_error(status as i32));
    }
    let _descriptor = LocalSecurity(descriptor);
    if descriptor.is_null()
        || owner.is_null()
        || dacl.is_null()
        || unsafe { EqualSid(owner, user) } == 0
    {
        return Err(denied("owner or DACL is not the current user"));
    }
    if require_protected_parent {
        let mut control = 0;
        let mut revision = 0;
        if unsafe { GetSecurityDescriptorControl(descriptor, &mut control, &mut revision) } == 0 {
            return Err(io::Error::last_os_error());
        }
        if control & SE_DACL_PROTECTED == 0 {
            return Err(denied("private parent DACL must block inherited grants"));
        }
    }
    if unsafe { (*dacl).AceCount } != 1 {
        return Err(denied("only one current-user allow ACE is supported"));
    }
    let mut ace: *mut c_void = std::ptr::null_mut();
    if unsafe { GetAce(dacl, 0, &mut ace) } == 0 {
        return Err(io::Error::last_os_error());
    }
    if ace.is_null() {
        return Err(denied("missing current-user allow ACE"));
    }
    // Validate the ACE's extent inside its ACL before reading the larger
    // allow structure or passing the contained SID to Windows.
    let header =
        unsafe { std::ptr::read_unaligned(ace.cast::<windows_sys::Win32::Security::ACE_HEADER>()) };
    let start = (ace as usize)
        .checked_sub(dacl as usize)
        .ok_or_else(|| denied("ACE address is outside DACL"))?;
    let size = usize::from(header.AceSize);
    let sid_offset = std::mem::offset_of!(ACCESS_ALLOWED_ACE, SidStart);
    if u32::from(header.AceType) != ACCESS_ALLOWED_ACE_TYPE
        || size < sid_offset + 8
        || start
            .checked_add(size)
            .is_none_or(|end| end > usize::from(unsafe { (*dacl).AclSize }))
    {
        return Err(denied("unsupported Windows private ACE"));
    }
    let sid = unsafe { ace.cast::<u8>().add(sid_offset) };
    let subauthorities = unsafe { *sid.add(1) } as usize;
    if subauthorities > 15 || sid_offset + 8 + subauthorities * 4 > size {
        return Err(denied("invalid Windows ACE SID extent"));
    }
    let allow = unsafe { std::ptr::read_unaligned(ace.cast::<ACCESS_ALLOWED_ACE>()) };
    if allow.Mask & FILE_ALL_ACCESS != FILE_ALL_ACCESS || unsafe { EqualSid(sid.cast(), user) } == 0
    {
        return Err(denied("unsupported Windows private ACE"));
    }
    if require_protected_parent {
        let required = OBJECT_INHERIT_ACE | CONTAINER_INHERIT_ACE;
        let flags = u32::from(allow.Header.AceFlags);
        if flags & required != required
            || flags & (INHERIT_ONLY_ACE | NO_PROPAGATE_INHERIT_ACE) != 0
        {
            return Err(denied(
                "current-user ACE must inherit to files and directories",
            ));
        }
    }
    Ok(())
}
