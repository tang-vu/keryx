//! Strict supported Windows shape: current-user owner and one current-user
//! full-access ACE. The selected parent also has protected inheritance and an
//! inheritable ACE, so newly created children cannot inherit broad grants.
use cap_std::fs::Dir;
use std::{
    ffi::c_void,
    io,
    os::windows::io::{AsRawHandle, FromRawHandle, RawHandle},
};
use windows_sys::Wdk::{
    Foundation::OBJECT_ATTRIBUTES,
    Storage::FileSystem::{
        NtCreateFile, FILE_CREATE, FILE_DIRECTORY_FILE, FILE_SYNCHRONOUS_IO_NONALERT,
    },
};
#[cfg(any(test, feature = "publication-evaluation"))]
use windows_sys::Win32::Security::{SetTokenInformation, TOKEN_ADJUST_DEFAULT};
use windows_sys::Win32::{
    Foundation::{
        CloseHandle, GetLastError, LocalFree, RtlNtStatusToDosError, ERROR_NO_TOKEN,
        OBJ_CASE_INSENSITIVE, UNICODE_STRING,
    },
    Security::{
        AddAccessAllowedAceEx,
        Authorization::{GetSecurityInfo, SE_FILE_OBJECT},
        EqualSid, GetAce, GetLengthSid, GetSecurityDescriptorControl, GetTokenInformation,
        InitializeAcl, InitializeSecurityDescriptor, SetSecurityDescriptorControl,
        SetSecurityDescriptorDacl, SetSecurityDescriptorOwner, TokenOwner, TokenUser,
        ACCESS_ALLOWED_ACE, ACL, ACL_REVISION, CONTAINER_INHERIT_ACE, DACL_SECURITY_INFORMATION,
        INHERIT_ONLY_ACE, NO_PROPAGATE_INHERIT_ACE, OBJECT_INHERIT_ACE, OWNER_SECURITY_INFORMATION,
        SECURITY_DESCRIPTOR, SE_DACL_PROTECTED, TOKEN_OWNER, TOKEN_QUERY, TOKEN_USER,
    },
    Storage::FileSystem::{FILE_ALL_ACCESS, FILE_GENERIC_READ},
    System::{
        SystemServices::{ACCESS_ALLOWED_ACE_TYPE, SECURITY_DESCRIPTOR_REVISION},
        Threading::{GetCurrentProcess, GetCurrentThread, OpenProcessToken, OpenThreadToken},
        IO::IO_STATUS_BLOCK,
    },
};

/// Create relative to the held ancestor with the complete private descriptor
/// attached to the create operation. No inherited broad grant is ever exposed.
pub(super) enum WorkspaceCreateError {
    Before(io::Error),
    After(io::Error),
}

pub(super) fn create_private_workspace(
    parent: &Dir,
    child: &str,
) -> Result<Dir, WorkspaceCreateError> {
    let token = current_user_sid().map_err(WorkspaceCreateError::Before)?;
    let user = unsafe { (*(token.as_ptr() as *const TOKEN_USER)).User.Sid };
    if user.is_null() {
        return Err(WorkspaceCreateError::Before(denied(
            "current-user SID is missing",
        )));
    }
    let sid_len = unsafe { GetLengthSid(user) } as usize;
    if !(8..=1024).contains(&sid_len) {
        return Err(WorkspaceCreateError::Before(denied(
            "unsupported current-user SID",
        )));
    }
    let acl_len =
        (std::mem::size_of::<ACL>() + std::mem::size_of::<ACCESS_ALLOWED_ACE>() - 4 + sid_len + 3)
            & !3;
    let mut acl_storage = vec![0usize; acl_len.div_ceil(std::mem::size_of::<usize>())];
    let acl = acl_storage.as_mut_ptr().cast::<ACL>();
    if unsafe { InitializeAcl(acl, acl_len as u32, ACL_REVISION) } == 0
        || unsafe {
            AddAccessAllowedAceEx(
                acl,
                ACL_REVISION,
                OBJECT_INHERIT_ACE | CONTAINER_INHERIT_ACE,
                FILE_ALL_ACCESS,
                user,
            )
        } == 0
    {
        return Err(WorkspaceCreateError::Before(io::Error::last_os_error()));
    }
    let mut descriptor = SECURITY_DESCRIPTOR::default();
    if unsafe {
        InitializeSecurityDescriptor(
            (&mut descriptor as *mut SECURITY_DESCRIPTOR).cast(),
            SECURITY_DESCRIPTOR_REVISION,
        )
    } == 0
        || unsafe {
            SetSecurityDescriptorDacl(
                (&mut descriptor as *mut SECURITY_DESCRIPTOR).cast(),
                1,
                acl,
                0,
            )
        } == 0
        || unsafe {
            SetSecurityDescriptorOwner(
                (&mut descriptor as *mut SECURITY_DESCRIPTOR).cast(),
                user,
                0,
            )
        } == 0
        || unsafe {
            SetSecurityDescriptorControl(
                (&mut descriptor as *mut SECURITY_DESCRIPTOR).cast(),
                SE_DACL_PROTECTED,
                SE_DACL_PROTECTED,
            )
        } == 0
    {
        return Err(WorkspaceCreateError::Before(io::Error::last_os_error()));
    }
    let mut wide: Vec<u16> = child.encode_utf16().collect();
    let name = UNICODE_STRING {
        Length: (wide.len() * 2) as u16,
        MaximumLength: (wide.len() * 2) as u16,
        Buffer: wide.as_mut_ptr(),
    };
    let attributes = OBJECT_ATTRIBUTES {
        Length: std::mem::size_of::<OBJECT_ATTRIBUTES>() as u32,
        RootDirectory: parent.as_raw_handle(),
        ObjectName: &name,
        Attributes: OBJ_CASE_INSENSITIVE,
        SecurityDescriptor: &descriptor,
        SecurityQualityOfService: std::ptr::null(),
    };
    let mut status = IO_STATUS_BLOCK::default();
    let mut handle = std::ptr::null_mut();
    let code = unsafe {
        NtCreateFile(
            &mut handle,
            FILE_GENERIC_READ,
            &attributes,
            &mut status,
            std::ptr::null(),
            0,
            7,
            FILE_CREATE,
            FILE_DIRECTORY_FILE | FILE_SYNCHRONOUS_IO_NONALERT,
            std::ptr::null(),
            0,
        )
    };
    if code < 0 {
        return Err(WorkspaceCreateError::Before(io::Error::from_raw_os_error(
            unsafe { RtlNtStatusToDosError(code) } as i32,
        )));
    }
    if handle.is_null() {
        return Err(WorkspaceCreateError::After(denied(
            "workspace create returned no handle",
        )));
    }
    // Hold the exact created object for owner/ACL and path-identity checks.
    Ok(Dir::from_std_file(unsafe {
        std::fs::File::from_raw_handle(handle)
    }))
}

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
        if size < std::mem::size_of::<TOKEN_USER>() as u32
            || size as usize > buffer.len() * std::mem::size_of::<usize>()
        {
            return Err(denied("invalid current-user token SID extent"));
        }
        Ok(buffer)
    })();
    if unsafe { CloseHandle(token) } == 0 {
        return Err(io::Error::last_os_error());
    }
    result
}

/// Publication uses the process token only. A thread impersonation token can
/// determine the owner of a new object, so refuse it before creating anything.
pub(super) fn admit_publication_token() -> io::Result<()> {
    let mut thread_token = std::ptr::null_mut();
    if unsafe { OpenThreadToken(GetCurrentThread(), TOKEN_QUERY, 1, &mut thread_token) } != 0 {
        let closed = unsafe { CloseHandle(thread_token) };
        if closed == 0 {
            return Err(io::Error::last_os_error());
        }
        return Err(denied(
            "thread impersonation is unsupported for task publication",
        ));
    }
    if unsafe { GetLastError() } != ERROR_NO_TOKEN {
        return Err(io::Error::last_os_error());
    }

    let mut process_token = std::ptr::null_mut();
    if unsafe { OpenProcessToken(GetCurrentProcess(), TOKEN_QUERY, &mut process_token) } == 0 {
        return Err(io::Error::last_os_error());
    }
    let result = (|| {
        let user = token_sid(process_token, TokenUser)?;
        let owner = token_sid(process_token, TokenOwner)?;
        let user_sid = unsafe { (*(user.as_ptr() as *const TOKEN_USER)).User.Sid };
        let owner_sid = unsafe { (*(owner.as_ptr() as *const TOKEN_OWNER)).Owner };
        if user_sid.is_null()
            || owner_sid.is_null()
            || unsafe { EqualSid(user_sid, owner_sid) } == 0
        {
            return Err(denied("process default owner is not the current user"));
        }
        Ok(())
    })();
    if unsafe { CloseHandle(process_token) } == 0 {
        return Err(io::Error::last_os_error());
    }
    result
}

fn token_sid(
    token: *mut c_void,
    class: windows_sys::Win32::Security::TOKEN_INFORMATION_CLASS,
) -> io::Result<Vec<usize>> {
    let mut size = 0;
    unsafe { GetTokenInformation(token, class, std::ptr::null_mut(), 0, &mut size) };
    let minimum = if class == TokenUser {
        std::mem::size_of::<TOKEN_USER>()
    } else {
        std::mem::size_of::<TOKEN_OWNER>()
    } as u32;
    if size < minimum || size > 65_536 {
        return Err(denied("cannot obtain process token SID"));
    }
    let words = (size as usize).div_ceil(std::mem::size_of::<usize>());
    let mut buffer = vec![0usize; words];
    if unsafe { GetTokenInformation(token, class, buffer.as_mut_ptr().cast(), size, &mut size) }
        == 0
    {
        return Err(io::Error::last_os_error());
    }
    if size < minimum || size as usize > buffer.len() * std::mem::size_of::<usize>() {
        return Err(denied("invalid process token SID extent"));
    }
    Ok(buffer)
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
